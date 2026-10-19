import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MetaDot, PageHeader } from '@/components/common/PageHeader';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Button } from '@/components/ui/Button';
import { StatusLamp } from '@/components/ui/StatusLamp';
import {
  IconChevronDown,
  IconChevronLeft,
  IconKey,
  IconMoreHorizontal,
  IconPlus,
  IconRefreshCw,
  IconUpload,
} from '@/components/ui/icons';
import { useQuotaAutoRefresh } from '@/features/quota/hooks/useQuotaAutoRefresh';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useInterval } from '@/hooks/useInterval';
import { useNow } from '@/hooks/useNow';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import { formatRelativeInstant } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { statusBarDataFromRecentRequests, type StatusBarData } from '@/utils/recentRequests';
import {
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  readAuthFileExcludedModels,
  resolveAuthFileExcludedRules,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { ActionMenu, type ActionMenuItem } from '@/features/authFiles/components/ActionMenu';
import { AuthFileDetailsSheet } from '@/features/authFiles/components/AuthFileDetailsSheet';
import { AuthFileRefreshResults } from '@/features/authFiles/components/AuthFileRefreshResults';
import { AuthFileRow, type AuthFileRowSection } from '@/features/authFiles/components/AuthFileRow';
import {
  AuthFilesSkeletonRows,
  AuthFilesTable,
} from '@/features/authFiles/components/AuthFilesTable';
import { AuthFilesToolbar } from '@/features/authFiles/components/AuthFilesToolbar';
import { OAuthExcludedCard } from '@/features/authFiles/components/OAuthExcludedCard';
import { OAuthModelAliasCard } from '@/features/authFiles/components/OAuthModelAliasCard';
import { UnderlineTabs } from '@/features/authFiles/components/UnderlineTabs';
import { tabId, tabPanelId } from '@/features/authFiles/components/underlineTabIds';
import { invalidateAuthFileDerivedCaches } from '@/features/authFiles/cacheInvalidation';
import {
  countAuthFileHealth,
  filterAuthFiles,
  getAuthFileProviderKey,
  getSelectableNames,
  getSelectedMatchingNames,
  matchesStatusFilter,
  resolveAuthFileQuotaType,
  sortAuthFiles,
} from '@/features/authFiles/logic';
import { getAuthFileRefreshKey } from '@/features/authFiles/manualRefresh';
import { forceRefreshAuthFileQuota } from '@/features/authFiles/quotaActions';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { useAuthFilesStatusBarCache } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import {
  isAuthFilesSortMode,
  isAuthFilesStatusFilterMode,
  readAuthFilesUiState,
  readPersistedAuthFilesCompactMode,
  writeAuthFilesUiState,
  writePersistedAuthFilesCompactMode,
  type AuthFilesSortMode,
  type AuthFilesStatusFilterMode,
} from '@/features/authFiles/uiState';
import styles from './AuthFilesPage.module.scss';

/** Rows per page; dense rows make a fixed size comfortable, pagination only kicks in for big pools. */
const PAGE_SIZE = 50;
const SKELETON_ROW_COUNT = 6;
const STATUS_MODES: AuthFilesStatusFilterMode[] = ['all', 'enabled', 'problem', 'disabled'];

type PageTab = 'accounts' | 'rules';
type DetailsTarget = { key: string; name: string; section: AuthFileRowSection };

const resolveStatusFilterMode = (
  problemOnly: boolean,
  disabledOnly: boolean
): AuthFilesStatusFilterMode => {
  if (problemOnly) return 'problem';
  if (disabledOnly) return 'disabled';
  return 'all';
};

const normalizePersistedStatusFilterMode = (value: unknown): AuthFilesStatusFilterMode | null => {
  if (value === 'disabledProblem') return 'problem';
  return isAuthFilesStatusFilterMode(value) ? value : null;
};

const activityFor = (file: AuthFileItem, cache: Map<string, StatusBarData>): StatusBarData => {
  const authIndexKey = typeof file.authIndex === 'string' ? file.authIndex : null;
  return (
    (authIndexKey && cache.get(authIndexKey)) ||
    statusBarDataFromRecentRequests(file.recentRequests ?? [])
  );
};

export function AuthFilesPage() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: PageTab = searchParams.get('tab') === 'rules' ? 'rules' : 'accounts';

  const [filter, setFilter] = useState<'all' | string>('all');
  const [statusFilterMode, setStatusFilterMode] = useState<AuthFilesStatusFilterMode>('all');
  const [compactMode, setCompactMode] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<'diagram' | 'list'>('list');
  const [sortMode, setSortMode] = useState<AuthFilesSortMode>('default');
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [details, setDetails] = useState<DetailsTarget | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const {
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsError,
    showModels,
    closeModelsModal,
    invalidateModels,
  } = useAuthFilesModels();

  const invalidateDerivedCaches = useCallback(
    (names?: string[]) => invalidateAuthFileDerivedCaches(invalidateModels, names),
    [invalidateModels]
  );

  const {
    files,
    selectedFiles,
    loading,
    refreshing,
    error,
    uploading,
    deleting,
    statusUpdating,
    manualRefreshing,
    refreshingAllCredentials,
    refreshResults,
    closeRefreshResults,
    handleRefreshAllCredentials,
    cooldownResetting,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDownload,
    handleManualRefresh,
    handleCooldownReset,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
  } = useAuthFilesData({ onFilesMutated: invalidateDerivedCaches });

  const statusBarCache = useAuthFilesStatusBarCache(files);

  const {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  } = useAuthFilesOauth({ viewMode, files });

  const disableControls = connectionStatus !== 'connected' || refreshingAllCredentials;

  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  } = useAuthFilesPrefixProxyEditor({
    disableControls,
    // Saving reloads in the background so the list never flashes back to skeletons.
    loadFiles: () => loadFiles({ background: true }),
    onFilesMutated: invalidateDerivedCaches,
  });

  const normalizedFilter = normalizeProviderKey(String(filter));
  const problemOnly = statusFilterMode === 'problem';
  const disabledOnly = statusFilterMode === 'disabled';

  /* ---------- UI state hydration and persistence (same localStorage keys and shape) ---------- */

  useEffect(() => {
    const persistedCompactMode = readPersistedAuthFilesCompactMode();
    if (typeof persistedCompactMode === 'boolean') {
      setCompactMode(persistedCompactMode);
    }

    const persisted = readAuthFilesUiState();
    if (persisted) {
      if (typeof persisted.filter === 'string' && persisted.filter.trim()) {
        setFilter(normalizeProviderKey(persisted.filter));
      }
      const persistedStatusFilterMode = normalizePersistedStatusFilterMode(
        persisted.statusFilterMode
      );
      if (persistedStatusFilterMode) {
        setStatusFilterMode(persistedStatusFilterMode);
      } else if (
        typeof persisted.problemOnly === 'boolean' ||
        typeof persisted.disabledOnly === 'boolean'
      ) {
        // Legacy shape: two booleans instead of one mode.
        setStatusFilterMode(
          resolveStatusFilterMode(persisted.problemOnly === true, persisted.disabledOnly === true)
        );
      }
      // Legacy shape: compact mode used to live inside the ui-state blob.
      if (typeof persistedCompactMode !== 'boolean' && typeof persisted.compactMode === 'boolean') {
        setCompactMode(persisted.compactMode);
      }
      if (typeof persisted.search === 'string') {
        setSearch(persisted.search);
      }
      if (typeof persisted.page === 'number' && Number.isFinite(persisted.page)) {
        setPage(Math.max(1, Math.round(persisted.page)));
      }
      if (isAuthFilesSortMode(persisted.sortMode)) {
        setSortMode(persisted.sortMode);
      }
    }

    setUiStateHydrated(true);
  }, []);

  useEffect(() => {
    if (!uiStateHydrated) return;

    writeAuthFilesUiState({
      filter,
      statusFilterMode,
      problemOnly,
      disabledOnly,
      compactMode,
      search,
      page,
      pageSize: PAGE_SIZE,
      sortMode,
    });
    writePersistedAuthFilesCompactMode(compactMode);
  }, [
    compactMode,
    disabledOnly,
    filter,
    page,
    problemOnly,
    search,
    sortMode,
    statusFilterMode,
    uiStateHydrated,
  ]);

  /* ---------- Loading: first load in the foreground (skeleton), then always in the background ---------- */

  const initialLoadDoneRef = useRef(false);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadFiles({ background: true }), loadExcluded(), loadModelAlias()]);
  }, [loadFiles, loadExcluded, loadModelAlias]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    if (!isCurrentLayer) return;
    void loadFiles(initialLoadDoneRef.current ? { background: true } : undefined);
    initialLoadDoneRef.current = true;
    loadExcluded();
    loadModelAlias();
  }, [isCurrentLayer, loadFiles, loadExcluded, loadModelAlias]);

  useInterval(
    () => {
      void loadFiles({ background: true }).catch(() => {});
    },
    isCurrentLayer ? 240_000 : null
  );

  // "Updated …" stamp: every completed list read that did not fail.
  const busy = loading || refreshing;
  const wasBusyRef = useRef(busy);
  useEffect(() => {
    if (wasBusyRef.current && !busy && !error) setLastUpdatedAt(Date.now());
    wasBusyRef.current = busy;
  }, [busy, error]);
  const now = useNow(lastUpdatedAt !== null);

  /* ---------- Filtering / sorting / pagination ---------- */

  const healthCounts = useMemo(() => countAuthFileHealth(files), [files]);

  const providerOptions = useMemo(() => {
    const counts = new Map<string, number>();
    files.forEach((file) => {
      const key = getAuthFileProviderKey(file);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts, ([key, count]) => ({ key, count })).sort((a, b) =>
      a.key.localeCompare(b.key)
    );
  }, [files]);

  // A persisted provider filter whose accounts are all gone falls back to "all".
  const activeProvider =
    normalizedFilter === 'all' || providerOptions.some((option) => option.key === normalizedFilter)
      ? normalizedFilter
      : 'all';

  const statusCounts = useMemo(() => {
    const scoped =
      activeProvider === 'all'
        ? files
        : files.filter((file) => getAuthFileProviderKey(file) === activeProvider);
    return Object.fromEntries(
      STATUS_MODES.map((mode) => [
        mode,
        scoped.filter((file) => matchesStatusFilter(file, mode)).length,
      ])
    ) as Record<AuthFilesStatusFilterMode, number>;
  }, [activeProvider, files]);

  const filtered = useMemo(
    () => filterAuthFiles(files, { provider: activeProvider, status: statusFilterMode, search }),
    [activeProvider, files, search, statusFilterMode]
  );
  const sorted = useMemo(() => sortAuthFiles(filtered, sortMode), [filtered, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = useMemo(() => sorted.slice(start, start + PAGE_SIZE), [sorted, start]);

  /* ---------- Selection: bulk actions only touch what is visible under the full filter ---------- */

  const selectedNames = useMemo(
    () => getSelectedMatchingNames(selectedFiles, sorted),
    [selectedFiles, sorted]
  );
  const matchingSelectableCount = useMemo(() => getSelectableNames(sorted).length, [sorted]);
  const pageSelectableNames = useMemo(() => getSelectableNames(pageItems), [pageItems]);
  const allPageSelected =
    pageSelectableNames.length > 0 && pageSelectableNames.every((name) => selectedFiles.has(name));
  const selectedHasStatusUpdating = useMemo(() => {
    const names = new Set(selectedNames);
    return files.some(
      (file) => names.has(file.name) && statusUpdating[getAuthFileRefreshKey(file)] === true
    );
  }, [files, selectedNames, statusUpdating]);
  const batchStatusDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;

  const handleSelectionModeChange = useCallback(
    (value: boolean) => {
      setSelectionMode(value);
      if (!value) deselectAll();
    },
    [deselectAll]
  );

  /* ---------- Quota: one shared refresh loop for the visible page ---------- */

  const { loadQuota } = useQuotaBatchLoader();
  const quotaEntries = useMemo<QuotaFileEntry[]>(
    () =>
      pageItems.flatMap((file) => {
        if (file.disabled === true || isRuntimeOnlyAuthFile(file)) return [];
        const type = resolveAuthFileQuotaType(file, 'all');
        return type ? [{ file, type }] : [];
      }),
    [pageItems]
  );
  useQuotaAutoRefresh(
    quotaEntries,
    !isCurrentLayer || tab !== 'accounts' || connectionStatus !== 'connected',
    loadQuota
  );

  const handleRefreshQuota = useCallback(
    (file: AuthFileItem, quotaType: QuotaProviderType) => {
      void forceRefreshAuthFileQuota(file, quotaType, t, showNotification);
    },
    [showNotification, t]
  );

  /* ---------- Activity scale shared by every row ---------- */

  const activityMax = useMemo(() => {
    let max = 1;
    files.forEach((file) => {
      activityFor(file, statusBarCache).blockDetails.forEach((block) => {
        max = Math.max(max, block.success + block.failure);
      });
    });
    return max;
  }, [files, statusBarCache]);

  /* ---------- Details sheet ---------- */

  const openEditorRef = useRef(openPrefixProxyEditor);
  useEffect(() => {
    openEditorRef.current = openPrefixProxyEditor;
  }, [openPrefixProxyEditor]);

  const handleOpenDetails = useCallback(
    (file: AuthFileItem, section: AuthFileRowSection = 'overview') => {
      setDetails({ key: getAuthFileRefreshKey(file), name: file.name, section });
      void openEditorRef.current(file);
      const providerKey = getAuthFileProviderKey(file);
      if (!isRuntimeOnlyAuthFile(file) || providerKey === 'aistudio') void showModels(file);
    },
    [showModels]
  );

  const handleCloseDetails = useCallback(() => {
    closePrefixProxyEditor();
    closeModelsModal();
    setDetails(null);
  }, [closeModelsModal, closePrefixProxyEditor]);

  const detailsFile = useMemo(() => {
    if (!details) return null;
    return (
      files.find((file) => getAuthFileRefreshKey(file) === details.key) ??
      files.find((file) => file.name === details.name) ??
      null
    );
  }, [details, files]);

  // Wait for the credential JSON: its own rules may replace the provider rules.
  const editorFileName = prefixProxyEditor?.fileName;
  const editorJson = prefixProxyEditor?.json;
  const detailsExcludedRules = useMemo(() => {
    if (!detailsFile || !editorJson || editorFileName !== detailsFile.name) return [];
    return resolveAuthFileExcludedRules(
      readAuthFileExcludedModels(editorJson),
      String(detailsFile.type ?? ''),
      excluded
    );
  }, [detailsFile, editorFileName, editorJson, excluded]);

  const copyTextWithNotification = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied
          ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  /* ---------- Navigation helpers ---------- */

  const setTab = useCallback(
    (next: PageTab) => {
      setSearchParams(next === 'rules' ? { tab: 'rules' } : {}, { replace: true });
    },
    [setSearchParams]
  );

  const openRuleEditor = useCallback(
    (path: 'oauth-excluded' | 'oauth-model-alias', provider?: string) => {
      const providerValue = (provider || (activeProvider !== 'all' ? activeProvider : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) params.set('provider', providerValue);
      const nextSearch = params.toString();
      navigate(`/auth-files/${path}${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [activeProvider, navigate]
  );

  const clearFilters = useCallback(() => {
    setFilter('all');
    setStatusFilterMode('all');
    setSearch('');
    setPage(1);
  }, []);

  const applyStatusFilter = useCallback(
    (mode: AuthFilesStatusFilterMode) => {
      setStatusFilterMode(mode);
      setPage(1);
      if (tab !== 'accounts') setTab('accounts');
    },
    [setTab, tab]
  );

  /* ---------- Header ---------- */

  const updatedLabel =
    lastUpdatedAt === null
      ? null
      : now - lastUpdatedAt < 60_000
        ? t('credentials.updated_just_now')
        : t('credentials.updated_ago', {
            time: formatRelativeInstant(lastUpdatedAt, now, i18n.resolvedLanguage),
          });

  const metaFilter = (
    mode: AuthFilesStatusFilterMode,
    lamp: 'ok' | 'warn' | 'fault' | 'idle',
    label: string
  ) => (
    <button
      type="button"
      className={`${styles.metaFilter} ${
        statusFilterMode === mode && tab === 'accounts' ? styles.metaFilterActive : ''
      }`}
      onClick={() => applyStatusFilter(statusFilterMode === mode ? 'all' : mode)}
      aria-pressed={statusFilterMode === mode && tab === 'accounts'}
    >
      <StatusLamp state={lamp} size={6} />
      {label}
    </button>
  );

  const headerMeta =
    loading && files.length === 0 ? (
      <span>{t('common.loading')}</span>
    ) : error && files.length === 0 ? null : (
      <>
        <span>{t('credentials.meta_total', { count: healthCounts.total })}</span>
        {healthCounts.total > 0 && (
          <>
            <MetaDot />
            {metaFilter(
              'enabled',
              'ok',
              t('credentials.meta_serving', { count: healthCounts.serving })
            )}
          </>
        )}
        {healthCounts.cooling > 0 && (
          <>
            <MetaDot />
            {metaFilter(
              'problem',
              'warn',
              t('credentials.meta_cooling', { count: healthCounts.cooling })
            )}
          </>
        )}
        {healthCounts.failing > 0 && (
          <>
            <MetaDot />
            {metaFilter(
              'problem',
              'fault',
              t('credentials.meta_failing', { count: healthCounts.failing })
            )}
          </>
        )}
        {healthCounts.disabled > 0 && (
          <>
            <MetaDot />
            {metaFilter(
              'disabled',
              'idle',
              t('credentials.meta_disabled', { count: healthCounts.disabled })
            )}
          </>
        )}
      </>
    );

  const addItems: ActionMenuItem[] = [
    {
      id: 'oauth',
      label: t('credentials.add_oauth'),
      icon: <IconKey size={15} />,
      onSelect: () => navigate('/oauth'),
    },
    {
      id: 'upload',
      label: t('credentials.add_upload'),
      icon: <IconUpload size={15} />,
      onSelect: handleUploadClick,
      disabled: disableControls || uploading,
    },
  ];

  const overflowItems: ActionMenuItem[] = [
    {
      id: 'refresh-all',
      label: t('credentials.refresh_all_tokens'),
      icon: <IconRefreshCw size={15} />,
      onSelect: handleRefreshAllCredentials,
      disabled:
        disableControls ||
        loading ||
        refreshingAllCredentials ||
        Object.keys(manualRefreshing).length > 0,
    },
  ];

  const headerActions = (
    <>
      {updatedLabel && (
        <span className={styles.updated} aria-live="polite">
          {refreshing ? t('credentials.refreshing') : updatedLabel}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void handleHeaderRefresh()}
        disabled={loading || refreshing}
        title={t('credentials.refresh_hint')}
      >
        <IconRefreshCw size={14} className={refreshing ? styles.spinning : undefined} />
        {t('common.refresh')}
      </Button>
      <ActionMenu
        items={addItems}
        label={t('credentials.add_account')}
        align="end"
        minWidth={220}
        triggerClassName="btn btn-primary btn-sm"
        trigger={
          <>
            {uploading ? (
              <span className="loading-spinner" aria-hidden="true" />
            ) : (
              <IconPlus size={14} />
            )}
            {t('credentials.add_account')}
            <IconChevronDown size={14} className={styles.chevron} />
          </>
        }
      />
      <ActionMenu
        items={overflowItems}
        label={t('credentials.more_actions')}
        iconOnly
        align="end"
        minWidth={220}
        triggerClassName={`btn btn-ghost btn-sm ${styles.iconButton}`}
        trigger={
          refreshingAllCredentials ? (
            <span className="loading-spinner" aria-hidden="true" />
          ) : (
            <IconMoreHorizontal size={16} />
          )
        }
      />
    </>
  );

  const rulesCount = Object.keys(excluded).length + Object.keys(modelAlias).length;

  /* ---------- Accounts body ---------- */

  const isFirstRunEmpty = !loading && files.length === 0 && !error;
  const isLoadFailure = !loading && files.length === 0 && Boolean(error);
  const isNoResults = !loading && files.length > 0 && pageItems.length === 0;

  const emptyPanel = (
    <section className={`${styles.panel} ${styles.emptyPanel}`}>
      <div className={styles.emptyIcon} aria-hidden="true">
        <IconKey size={18} />
      </div>
      <h2 className={styles.emptyTitle}>{t('auth_files.empty_title')}</h2>
      <p className={styles.emptyText}>{t('credentials.empty_desc')}</p>
      <div className={styles.emptyActions}>
        <Button size="sm" onClick={() => navigate('/oauth')}>
          <IconKey size={14} />
          {t('credentials.add_oauth')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleUploadClick}
          disabled={disableControls || uploading}
          loading={uploading}
        >
          {!uploading && <IconUpload size={14} />}
          {t('credentials.add_upload')}
        </Button>
      </div>
    </section>
  );

  const accountsBody = isFirstRunEmpty ? (
    emptyPanel
  ) : isLoadFailure ? (
    <section className={`${styles.panel} ${styles.emptyPanel}`}>
      <div className={`${styles.emptyIcon} ${styles.emptyIconFault}`} aria-hidden="true">
        <IconRefreshCw size={18} />
      </div>
      <h2 className={styles.emptyTitle}>{t('credentials.load_failed')}</h2>
      <p className={styles.emptyText}>{error}</p>
      <div className={styles.emptyActions}>
        <Button variant="secondary" size="sm" onClick={() => void loadFiles()}>
          {t('credentials.retry')}
        </Button>
      </div>
    </section>
  ) : (
    <>
      {error && (
        <div className={styles.inlineError} role="alert">
          <span>
            {t('credentials.load_failed')} · {error}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadFiles({ background: true })}
          >
            {t('credentials.retry')}
          </Button>
        </div>
      )}
      <section className={styles.panel}>
        <AuthFilesToolbar
          resolvedTheme={resolvedTheme}
          providers={providerOptions}
          providerTotal={files.length}
          provider={activeProvider}
          onProviderChange={(value) => {
            setFilter(value);
            setPage(1);
          }}
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          status={statusFilterMode}
          statusCounts={statusCounts}
          onStatusChange={applyStatusFilter}
          sortMode={sortMode}
          onSortModeChange={(mode) => {
            setSortMode(mode);
            setPage(1);
          }}
          compact={compactMode}
          onCompactChange={setCompactMode}
          selectionMode={selectionMode}
          onSelectionModeChange={handleSelectionModeChange}
          selectedCount={selectedNames.length}
          matchingSelectableCount={matchingSelectableCount}
          onSelectAllMatching={() => selectAllVisible(sorted)}
          onClearSelection={deselectAll}
          disableControls={disableControls}
          batchStatusDisabled={batchStatusDisabled}
          onEnable={() => void batchSetStatus(selectedNames, true)}
          onDisable={() => void batchSetStatus(selectedNames, false)}
          onDownload={() => void batchDownload(selectedNames)}
          onDelete={() => batchDelete(selectedNames)}
        />

        {loading ? (
          <AuthFilesSkeletonRows count={SKELETON_ROW_COUNT} compact={compactMode} />
        ) : isNoResults ? (
          <div className={styles.noResults}>
            <p className={styles.emptyTitle}>{t('credentials.no_results')}</p>
            <p className={styles.emptyText}>{t('auth_files.search_empty_desc')}</p>
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              {t('auth_files.no_results_clear')}
            </Button>
          </div>
        ) : (
          <AuthFilesTable
            compact={compactMode}
            selectionMode={selectionMode}
            allSelected={allPageSelected}
            selectableCount={pageSelectableNames.length}
            onToggleAll={(checked) => (checked ? selectAllVisible(pageItems) : deselectAll())}
          >
            {pageItems.map((file) => (
              <AuthFileRow
                key={getQuotaCacheKey(file)}
                file={file}
                selected={selectedFiles.has(file.name)}
                selectionMode={selectionMode}
                resolvedTheme={resolvedTheme}
                disableControls={disableControls}
                deleting={deleting}
                statusUpdating={statusUpdating}
                manualRefreshing={manualRefreshing}
                cooldownResetting={cooldownResetting}
                activity={activityFor(file, statusBarCache)}
                activityMax={activityMax}
                onOpenDetails={handleOpenDetails}
                onToggleSelect={toggleSelect}
                onToggleStatus={handleStatusToggle}
                onDownload={handleDownload}
                onManualRefresh={handleManualRefresh}
                onCooldownReset={handleCooldownReset}
                onRefreshQuota={handleRefreshQuota}
                onDelete={handleDelete}
              />
            ))}
          </AuthFilesTable>
        )}

        {!loading && sorted.length > PAGE_SIZE && (
          <footer className={styles.pagination}>
            <span className={styles.pageInfo}>
              {t('credentials.pagination', {
                from: start + 1,
                to: Math.min(start + PAGE_SIZE, sorted.length),
                total: sorted.length,
              })}
            </span>
            <div className={styles.pageButtons}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
                aria-label={t('auth_files.pagination_prev')}
                title={t('auth_files.pagination_prev')}
              >
                <IconChevronLeft size={16} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages}
                aria-label={t('auth_files.pagination_next')}
                title={t('auth_files.pagination_next')}
              >
                <IconChevronLeft size={16} className={styles.flip} />
              </Button>
            </div>
          </footer>
        )}
      </section>
    </>
  );

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('credentials.title')}
        meta={headerMeta}
        actions={headerActions}
        tabs={
          <UnderlineTabs
            idPrefix="credentials"
            label={t('credentials.title')}
            value={tab}
            onChange={setTab}
            tabs={[
              {
                id: 'accounts',
                label: t('credentials.tab_accounts'),
                count: loading && files.length === 0 ? undefined : files.length,
              },
              { id: 'rules', label: t('credentials.tab_rules'), count: rulesCount },
            ]}
          />
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        onChange={handleFileChange}
      />

      <div
        role="tabpanel"
        id={tabPanelId('credentials', tab)}
        aria-labelledby={tabId('credentials', tab)}
        className={styles.tabPanel}
      >
        {tab === 'accounts' ? (
          accountsBody
        ) : (
          <div className={styles.rules}>
            <OAuthExcludedCard
              disableControls={disableControls}
              excludedError={excludedError}
              excluded={excluded}
              onRetry={loadExcluded}
              onAdd={() => openRuleEditor('oauth-excluded')}
              onEdit={(provider) => openRuleEditor('oauth-excluded', provider)}
              onDelete={deleteExcluded}
            />
            <OAuthModelAliasCard
              disableControls={disableControls}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onRetry={loadModelAlias}
              onAdd={() => openRuleEditor('oauth-model-alias')}
              onEditProvider={(provider) => openRuleEditor('oauth-model-alias', provider)}
              onDeleteProvider={deleteModelAlias}
              modelAliasError={modelAliasError}
              modelAlias={modelAlias}
              allProviderModels={allProviderModels}
              onUpdate={handleMappingUpdate}
              onDeleteLink={handleDeleteLink}
              onToggleFork={handleToggleFork}
              onRenameAlias={handleRenameAlias}
              onDeleteAlias={handleDeleteAlias}
            />
          </div>
        )}
      </div>

      <AuthFileRefreshResults results={refreshResults} onClose={closeRefreshResults} />

      <AuthFileDetailsSheet
        file={detailsFile}
        initialSection={details?.section === 'models' ? 'models' : 'overview'}
        resolvedTheme={resolvedTheme}
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        statusUpdating={statusUpdating}
        manualRefreshing={manualRefreshing}
        cooldownResetting={cooldownResetting}
        activity={detailsFile ? activityFor(detailsFile, statusBarCache) : null}
        models={{
          loading: modelsLoading,
          error: modelsError,
          list: details && modelsFileName === details.name ? modelsList : [],
          excludedRules: detailsExcludedRules,
        }}
        onClose={handleCloseDetails}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onChange={handlePrefixProxyChange}
        onToggleStatus={handleStatusToggle}
        onCooldownReset={handleCooldownReset}
      />
    </div>
  );
}

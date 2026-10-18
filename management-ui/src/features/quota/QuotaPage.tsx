/** Quota: pool capacity summary and per-provider account cards with session-scoped loading. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  IconArrowUpDown,
  IconChevronDown,
  IconRefreshCw,
  IconSearch,
  IconX,
} from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useAuthStore, useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem, ClaudeQuotaState, ResolvedTheme } from '@/types';
import { getQuotaCacheKey, getQuotaCardTitle } from '@/utils/quota/identity';
import { getCredentialLampState } from '@/components/layout/poolRail';
import { ActionMenu, type ActionMenuItem } from '@/features/authFiles/components/ActionMenu';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { cooldownRemainingSeconds, summarizeCooldowns } from '@/features/authFiles/cooldowns';
import { ProviderTabs } from './components/ProviderTabs';
import { QuotaCard } from './components/QuotaCard';
import { QuotaSummary } from './components/QuotaSummary';
import {
  QUOTA_PAGE_SIZE,
  QUOTA_SORT_MODES,
  QUOTA_TAB_ORDER,
  type QuotaSortMode,
  type QuotaTabId,
} from './constants';
import {
  buildTabCounts,
  canRefreshQuotaAfterList,
  classifyQuotaFiles,
  filterEntriesByTab,
  filterEntriesBySearch,
  paginate,
  sortQuotaEntries,
  type QuotaFileEntry,
} from './logic';
import { buildAccountOverview, type AccountOverview } from './accountCardModel';
import {
  buildGroupSummary,
  buildPoolSummary,
  snapshotAccount,
  type AccountSnapshot,
} from './poolSummary';
import { formatCompactDuration } from './format';
import { QUOTA_ADAPTERS, getQuotaSetter, type QuotaCardState } from './providers';
import { hasClaudeUsageData } from './providers/claude/data';
import type { QuotaProviderType } from './providers/types';
import { useQuotaAutoRefresh } from './hooks/useQuotaAutoRefresh';
import { useQuotaActions } from './hooks/useQuotaActions';
import { useQuotaBatchLoader } from './hooks/useQuotaBatchLoader';
import { readQuotaUiState, writeQuotaUiState } from './uiState';
import styles from './QuotaPage.module.scss';

const SKELETON_CARD_COUNT = 3;

const entryKey = (entry: QuotaFileEntry) => `${entry.type}:${getQuotaCacheKey(entry.file)}`;

/** Remaining cooldown on the whole credential plus the number of paused models. */
function readCooldown(file: AuthFileItem, nowMs: number) {
  const snapshot = file.cooldownSnapshot;
  if (!snapshot?.records?.length) return null;
  const summary = summarizeCooldowns(snapshot, nowMs);
  const credentialSeconds = snapshot.records
    .filter((record) => record.scope === 'credential')
    .map((record) => cooldownRemainingSeconds(record, snapshot.receivedAtMs, nowMs))
    .filter((seconds) => seconds > 0);
  return {
    credentialSeconds: credentialSeconds.length ? Math.min(...credentialSeconds) : 0,
    modelCount: summary.modelCount,
  };
}

export function QuotaPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<QuotaTabId>(() => readQuotaUiState()?.tab ?? 'all');
  const [sortMode, setSortMode] = useState<QuotaSortMode>(
    () => readQuotaUiState()?.sortMode ?? 'name'
  );
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const disableControls = connectionStatus !== 'connected';

  /* Credential list (session-scoped). */

  const sessionGeneration = useQuotaStore((state) => state.cacheGeneration);
  const [filesGeneration, setFilesGeneration] = useState<number | null>(null);
  const listRequestRef = useRef(0);
  const loadFiles = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesGeneration(null);
      setLoading(false);
      return;
    }
    const isCurrent = () =>
      requestId === listRequestRef.current &&
      sessionGeneration === useQuotaStore.getState().cacheGeneration;
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      if (!isCurrent()) return;
      setFiles(data?.files || []);
      setFilesGeneration(sessionGeneration);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [connectionStatus, sessionGeneration, t]);

  useHeaderRefresh(loadFiles);

  useEffect(() => {
    void loadFiles();
    return () => {
      listRequestRef.current += 1;
    };
  }, [loadFiles]);

  /* Quota state from the shared store. */

  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const devinQuota = useQuotaStore((state) => state.devinQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const metaQuota = useQuotaStore((state) => state.metaQuota);
  const pluginQuota = useQuotaStore((state) => state.pluginQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);

  const quotaByType = useMemo<Record<QuotaProviderType, Record<string, QuotaCardState>>>(
    () =>
      ({
        antigravity: antigravityQuota,
        claude: claudeQuota,
        codex: codexQuota,
        devin: devinQuota,
        kimi: kimiQuota,
        meta: metaQuota,
        plugin: pluginQuota,
        xai: xaiQuota,
      }) as unknown as Record<QuotaProviderType, Record<string, QuotaCardState>>,
    [
      antigravityQuota,
      claudeQuota,
      codexQuota,
      devinQuota,
      kimiQuota,
      metaQuota,
      pluginQuota,
      xaiQuota,
    ]
  );

  const getQuota = useCallback(
    (entry: QuotaFileEntry): QuotaCardState | undefined =>
      quotaByType[entry.type][getQuotaCacheKey(entry.file)],
    [quotaByType]
  );

  /* Per-account model: overview → snapshot. Shared by the summary, sections, sort and cards. */

  const now = useNow();
  const entries = useMemo(() => classifyQuotaFiles(files), [files]);

  const overviews = useMemo(() => {
    const map = new Map<string, AccountOverview | null>();
    for (const entry of entries) {
      const quota = getQuota(entry);
      const visible =
        quota &&
        (quota.status === 'success' ||
          quota.hasData ||
          (entry.type === 'claude' && hasClaudeUsageData(quota as ClaudeQuotaState)));
      map.set(entryKey(entry), visible ? buildAccountOverview(entry.type, quota, t, locale) : null);
    }
    return map;
  }, [entries, getQuota, t, locale]);

  // Claude reset grants are read per card, so cards report their counts upward.
  const [resetCounts, setResetCounts] = useState<Record<string, number | null>>({});
  const handleResetCount = useCallback((key: string, count: number | null) => {
    setResetCounts((previous) =>
      previous[key] === count ? previous : { ...previous, [key]: count }
    );
  }, []);

  const cooldowns = useMemo(() => {
    const map = new Map<string, ReturnType<typeof readCooldown>>();
    for (const entry of entries) map.set(entryKey(entry), readCooldown(entry.file, now));
    return map;
  }, [entries, now]);

  const snapshots = useMemo(() => {
    const map = new Map<string, AccountSnapshot>();
    for (const entry of entries) {
      const key = entryKey(entry);
      map.set(
        key,
        snapshotAccount({
          key,
          name: getQuotaCardTitle(entry.file),
          type: entry.type,
          overview: overviews.get(key) ?? null,
          lamp: getCredentialLampState(entry.file),
          failing: getQuota(entry)?.status === 'error',
          cooldownSeconds: cooldowns.get(key)?.credentialSeconds ?? 0,
          resets: resetCounts[getQuotaCacheKey(entry.file)] ?? null,
        })
      );
    }
    return map;
  }, [cooldowns, entries, getQuota, overviews, resetCounts]);

  const poolSummary = useMemo(
    () => buildPoolSummary([...snapshots.values()], now),
    [snapshots, now]
  );

  /* Filters, sorting and pagination. */

  const tabCounts = useMemo(() => buildTabCounts(entries), [entries]);
  const tabTypes = useMemo(
    () => ['all', ...QUOTA_TAB_ORDER.filter((type) => (tabCounts[type] ?? 0) > 0)],
    [tabCounts]
  );
  // A single provider needs no filter at all.
  const showTabs = tabTypes.length > 2;
  // A remembered provider with no accounts left falls back to all accounts.
  const activeTab: QuotaTabId = tab === 'all' || (tabCounts[tab] ?? 0) > 0 ? tab : 'all';
  const filteredEntries = useMemo(
    () => filterEntriesBySearch(filterEntriesByTab(entries, activeTab), search),
    [entries, activeTab, search]
  );
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const resolveSortKey = useCallback(
    (entry: QuotaFileEntry): number | null => {
      const snapshot = snapshots.get(entryKey(entry));
      if (!snapshot) return null;
      if (sortMode === 'remaining') return snapshot.hero?.remaining ?? null;
      return snapshot.recoverAtMs;
    },
    [snapshots, sortMode]
  );
  // Sort before pagination to rank all matching accounts.
  const sortedEntries = useMemo(
    () => sortQuotaEntries(filteredEntries, sortMode, resolveSortKey),
    [filteredEntries, sortMode, resolveSortKey]
  );

  const { pageItems, currentPage, totalPages } = useMemo(
    () => paginate(sortedEntries, page, QUOTA_PAGE_SIZE),
    [sortedEntries, page]
  );

  // Polling targets in a stable order, so a live re-sort never restarts the refresh loop.
  const pollItems = useMemo(
    () => [...pageItems].sort((a, b) => (entryKey(a) < entryKey(b) ? -1 : 1)),
    [pageItems]
  );

  const groups = useMemo(() => {
    const byType = new Map<QuotaProviderType, QuotaFileEntry[]>();
    for (const entry of pageItems) {
      const list = byType.get(entry.type) ?? [];
      list.push(entry);
      byType.set(entry.type, list);
    }
    return QUOTA_TAB_ORDER.filter((type) => byType.has(type)).map((type) => ({
      type,
      entries: byType.get(type) ?? [],
    }));
  }, [pageItems]);

  const handleTabChange = useCallback((next: string) => {
    setTab(next as QuotaTabId);
    setPage(1);
    writeQuotaUiState({ tab: next as QuotaTabId });
  }, []);

  const handleSortModeChange = useCallback((next: string) => {
    setSortMode(next as QuotaSortMode);
    setPage(1);
    writeQuotaUiState({ sortMode: next as QuotaSortMode });
  }, []);

  const sortItems = useMemo<ActionMenuItem[]>(
    () =>
      QUOTA_SORT_MODES.map((mode) => ({
        id: mode,
        label: t(`quota_management.sort_${mode}`),
        checked: sortMode === mode,
        onSelect: () => handleSortModeChange(mode),
      })),
    [handleSortModeChange, sortMode, t]
  );

  // Prune cached quotas after the credential list settles.
  useEffect(() => {
    if (loading || error || filesGeneration !== sessionGeneration) return;
    const survivorsByType = new Map<QuotaProviderType, Set<string>>(
      QUOTA_TAB_ORDER.map((type) => [type, new Set<string>()])
    );
    entries.forEach((entry) => survivorsByType.get(entry.type)?.add(getQuotaCacheKey(entry.file)));

    QUOTA_TAB_ORDER.forEach((type) => {
      const survivors = survivorsByType.get(type) ?? new Set<string>();
      const setQuota = getQuotaSetter(QUOTA_ADAPTERS[type]);
      setQuota((prev) => {
        const staleKeys = Object.keys(prev).filter((name) => !survivors.has(name));
        if (staleKeys.length === 0) return prev;
        const next = { ...prev };
        staleKeys.forEach((name) => delete next[name]);
        return next;
      });
    });
  }, [entries, error, filesGeneration, loading, sessionGeneration]);

  /* Loading and actions. */

  const { batchLoading, loadQuota } = useQuotaBatchLoader();
  const { resettingQuotaName, refreshQuota, resetQuota } = useQuotaActions(disableControls);

  const pendingRefreshRef = useRef<number | null>(null);
  const prevLoadingRef = useRef(loading);

  // Reload credentials before refreshing the quotas on the current page.
  const handleRefreshAll = useCallback(() => {
    if (disableControls) return;
    pendingRefreshRef.current = sessionGeneration;
    void loadFiles();
  }, [disableControls, loadFiles, sessionGeneration]);

  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    const requestedSession = pendingRefreshRef.current;
    if (requestedSession === null) return;
    if (requestedSession !== sessionGeneration) {
      pendingRefreshRef.current = null;
      return;
    }
    if (loading || !wasLoading) return;

    pendingRefreshRef.current = null;
    if (
      canRefreshQuotaAfterList(
        requestedSession,
        sessionGeneration,
        filesGeneration,
        Boolean(error),
        disableControls
      )
    ) {
      void loadQuota(pageItems);
    }
  }, [disableControls, error, filesGeneration, loading, loadQuota, pageItems, sessionGeneration]);

  const restoringQuota = useQuotaAutoRefresh(
    pollItems,
    disableControls || loading || Boolean(error) || filesGeneration !== sessionGeneration,
    loadQuota
  );

  const canUseActions = !disableControls && !loading && filesGeneration === sessionGeneration;
  // Only a user-initiated reload spins the toolbar; first load shows skeletons instead.
  const refreshing = batchLoading || (loading && files.length > 0);

  const isEmpty = !loading && filteredEntries.length === 0;
  const hasPageData = pageItems.some((entry) => overviews.get(entryKey(entry)));
  const showSkeleton = (loading && files.length === 0) || (restoringQuota && !hasPageData);
  const searching = search.trim().length > 0;

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('quota_management.page_title')}
        meta={<span>{t('quota_management.accounts', { count: entries.length })}</span>}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefreshAll}
            className={styles.refreshAll}
            disabled={disableControls || refreshing}
          >
            <IconRefreshCw
              size={14}
              className={refreshing ? styles.spinning : undefined}
              aria-hidden="true"
            />
            {t('quota_management.refresh_all')}
          </Button>
        }
      />

      <QuotaSummary summary={poolSummary} now={now} loading={loading && files.length === 0} />

      <div className={showTabs ? `${styles.toolbar} ${styles.toolbarTabs}` : styles.toolbar}>
        {showTabs && (
          <div className={styles.filters}>
            <ProviderTabs
              types={tabTypes}
              counts={tabCounts}
              active={activeTab}
              resolvedTheme={resolvedTheme}
              onChange={handleTabChange}
            />
          </div>
        )}
        <div className={styles.search}>
          <IconSearch size={14} className={styles.searchIcon} aria-hidden="true" />
          <input
            ref={searchInputRef}
            className={styles.searchInput}
            type="search"
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={t('quota_management.search_placeholder')}
            title={t('quota_management.search_hint')}
            aria-label={t('quota_management.search_label')}
          />
          {search && (
            <button
              type="button"
              className={styles.clearSearch}
              aria-label={t('quota_management.search_clear')}
              title={t('quota_management.search_clear')}
              onClick={() => {
                handleSearchChange('');
                searchInputRef.current?.focus();
              }}
            >
              <IconX size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className={styles.sort}>
          <ActionMenu
            items={sortItems}
            label={t('quota_management.sort_label')}
            align="end"
            minWidth={200}
            triggerClassName={styles.sortTrigger}
            trigger={
              <>
                <IconArrowUpDown size={14} className={styles.sortIcon} aria-hidden="true" />
                <span className={styles.sortValue}>
                  {t('quota_management.sort_by', {
                    mode: t(`quota_management.sort_${sortMode}`),
                  })}
                </span>
                <IconChevronDown size={14} className={styles.sortIcon} aria-hidden="true" />
              </>
            }
          />
        </div>
      </div>

      {error && (
        <div className={`error-box ${styles.listError}`} role="alert">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void loadFiles()}>
            {t('quota_management.retry')}
          </Button>
        </div>
      )}

      {showSkeleton ? (
        <div className={styles.grid} aria-hidden="true">
          {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
            <Skeleton key={index} height={220} rounded={8} />
          ))}
        </div>
      ) : isEmpty ? (
        <EmptyState
          title={
            searching
              ? t('quota_management.search_empty_title')
              : activeTab === 'all'
                ? t('quota_management.empty_title')
                : t(`${QUOTA_ADAPTERS[activeTab].i18nPrefix}.empty_title`)
          }
          description={
            searching
              ? t('quota_management.search_empty_desc')
              : activeTab === 'all'
                ? t('quota_management.empty_desc')
                : t(`${QUOTA_ADAPTERS[activeTab].i18nPrefix}.empty_desc`)
          }
          action={
            searching ? (
              <Button variant="secondary" size="sm" onClick={() => handleSearchChange('')}>
                {t('quota_management.search_clear')}
              </Button>
            ) : activeTab === 'all' ? undefined : (
              <Button variant="secondary" size="sm" onClick={() => handleTabChange('all')}>
                {t('auth_files.filter_all')}
              </Button>
            )
          }
        />
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => {
            const groupSnapshots = group.entries
              .map((entry) => snapshots.get(entryKey(entry)))
              .filter((snapshot): snapshot is AccountSnapshot => Boolean(snapshot));
            const summary = buildGroupSummary(groupSnapshots, now);
            const label = getTypeLabel(t, group.type);
            const icon =
              group.type === 'plugin' ? null : getAuthFileIcon(group.type, resolvedTheme);
            const headingId = `quota-group-${group.type}`;
            return (
              <section key={group.type} className={styles.group} aria-labelledby={headingId}>
                <header className={styles.groupHead}>
                  <span
                    className={styles.glyph}
                    style={
                      isThemeSurfaceIconProvider(group.type)
                        ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                        : undefined
                    }
                    aria-hidden="true"
                  >
                    {icon ? <img src={icon} alt="" /> : label.slice(0, 1).toUpperCase()}
                  </span>
                  <h2 id={headingId} className={styles.groupTitle}>
                    {label}
                  </h2>
                  <p className={styles.groupMeta}>
                    <span>{t('quota_management.accounts', { count: summary.count })}</span>
                    <span>
                      {t('quota_management.group_available', { count: summary.available })}
                    </span>
                    {summary.nextResetMs !== null && (
                      <span>
                        {t('quota_management.group_next_reset', {
                          duration: formatCompactDuration(t, summary.nextResetMs - now),
                        })}
                      </span>
                    )}
                  </p>
                </header>
                <div className={styles.grid}>
                  {group.entries.map((entry) => {
                    const key = entryKey(entry);
                    const snapshot = snapshots.get(key);
                    if (!snapshot) return null;
                    return (
                      <QuotaCard
                        key={key}
                        entry={entry}
                        quota={getQuota(entry)}
                        overview={overviews.get(key) ?? null}
                        snapshot={snapshot}
                        cooldown={cooldowns.get(key) ?? null}
                        canRefresh={canUseActions && !entry.file.disabled}
                        resetting={resettingQuotaName === getQuotaCacheKey(entry.file)}
                        onRefresh={() => refreshQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
                        onReset={() => resetQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
                        onResetCount={handleResetCount}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {!loading && filteredEntries.length > QUOTA_PAGE_SIZE && (
        <nav className={styles.pagination} aria-label={t('quota_management.pagination_label')}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
          >
            {t('auth_files.pagination_prev')}
          </Button>
          <span className={styles.pageInfo}>
            {t('quota_management.pagination_info', {
              current: currentPage,
              total: totalPages,
            })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
          >
            {t('auth_files.pagination_next')}
          </Button>
        </nav>
      )}
    </div>
  );
}

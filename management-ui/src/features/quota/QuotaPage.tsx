/** Quota: provider overview strip and per-provider credential tables with session-scoped loading. */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { MetaDot, PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconArrowUpDown, IconChevronDown, IconRefreshCw } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusLamp, type LampState } from '@/components/ui/StatusLamp';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useAuthStore, useQuotaStore } from '@/stores';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
import { getQuotaCacheKey, getQuotaCardTitle } from '@/utils/quota/identity';
import { getCredentialLampState } from '@/components/layout/poolRail';
import { ActionMenu, type ActionMenuItem } from '@/features/authFiles/components/ActionMenu';
import { cooldownRemainingSeconds, summarizeCooldowns } from '@/features/authFiles/cooldowns';
import { ProviderOverview } from './components/ProviderOverview';
import { QuotaRow } from './components/QuotaRow';
import { QuotaSection, QuotaSections } from './components/QuotaSection';
import {
  QUOTA_SORT_MODES,
  QUOTA_TAB_ORDER,
  type QuotaSortMode,
  type QuotaTabId,
} from './constants';
import {
  buildTabCounts,
  canRefreshQuotaAfterList,
  classifyQuotaFiles,
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
import { buildProviderSummary, findLimit } from './providerSummary';
import { buildWindowColumns } from './tableColumns';
import { QUOTA_ADAPTERS, getQuotaSetter, type QuotaCardState } from './providers';
import { hasClaudeUsageData } from './providers/claude/data';
import type { QuotaProviderType } from './providers/types';
import { useQuotaAutoRefresh } from './hooks/useQuotaAutoRefresh';
import { useQuotaActions } from './hooks/useQuotaActions';
import { useQuotaBatchLoader } from './hooks/useQuotaBatchLoader';
import { readQuotaUiState, writeQuotaUiState } from './uiState';
import styles from './QuotaPage.module.scss';

const SKELETON_ROW_COUNT = 3;

const entryKey = (entry: QuotaFileEntry) => `${entry.type}:${getQuotaCacheKey(entry.file)}`;

const supportsManualReset = (type: QuotaProviderType) =>
  type === 'claude' || Boolean(QUOTA_ADAPTERS[type].resetQuota);

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

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<QuotaTabId>(() => readQuotaUiState()?.tab ?? 'all');
  const [sortMode, setSortMode] = useState<QuotaSortMode>(
    () => readQuotaUiState()?.sortMode ?? 'name'
  );
  const [focalPins, setFocalPins] = useState<Partial<Record<QuotaProviderType, string>>>(
    () => readQuotaUiState()?.focal ?? {}
  );
  // Names stay blurred until revealed; the choice lives only as long as the page.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());

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

  /* Per-account model: overview → snapshot. Shared by the header, strip, tables and sort. */

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

  // Claude reset grants are read per row, so rows report their counts upward.
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

  /* Providers: focal windows come from the stable list order, so sorting can't flip them. */

  const tabCounts = useMemo(() => buildTabCounts(entries), [entries]);
  const providerTypes = useMemo(
    () => QUOTA_TAB_ORDER.filter((type) => (tabCounts[type] ?? 0) > 0),
    [tabCounts]
  );
  // A single provider needs no filter at all.
  const filterable = providerTypes.length > 1;
  // A remembered provider with no accounts left falls back to all accounts.
  const activeTab: QuotaTabId =
    filterable && tab !== 'all' && (tabCounts[tab] ?? 0) > 0 ? tab : 'all';

  const snapshotsByType = useMemo(() => {
    const map = new Map<QuotaProviderType, AccountSnapshot[]>();
    for (const entry of entries) {
      const snapshot = snapshots.get(entryKey(entry));
      if (!snapshot) continue;
      map.set(entry.type, [...(map.get(entry.type) ?? []), snapshot]);
    }
    return map;
  }, [entries, snapshots]);

  const focalByType = useMemo(() => {
    const map = new Map<QuotaProviderType, string | null>();
    for (const type of providerTypes) {
      const summary = buildProviderSummary(
        type,
        snapshotsByType.get(type) ?? [],
        focalPins[type],
        now
      );
      map.set(type, summary.focal?.id ?? null);
    }
    return map;
  }, [focalPins, now, providerTypes, snapshotsByType]);

  /* Sorting: by the provider's focal window. */

  const resolveSortKey = useCallback(
    (entry: QuotaFileEntry): number | null => {
      const snapshot = snapshots.get(entryKey(entry));
      const limit = findLimit(snapshot?.overview ?? null, focalByType.get(entry.type) ?? null);
      if (!limit || limit.remaining === null) return null;
      if (sortMode === 'remaining') return limit.remaining;
      // A full window has nothing to bring back.
      return limit.remaining < 100 ? limit.resetAtMs : null;
    },
    [focalByType, snapshots, sortMode]
  );
  const sortedEntries = useMemo(
    () => sortQuotaEntries(entries, sortMode, resolveSortKey),
    [entries, sortMode, resolveSortKey]
  );

  // Segments follow the table order.
  const providerSummaries = useMemo(
    () =>
      providerTypes.map((type) =>
        buildProviderSummary(
          type,
          sortedEntries
            .filter((entry) => entry.type === type)
            .map((entry) => snapshots.get(entryKey(entry)))
            .filter((snapshot): snapshot is AccountSnapshot => Boolean(snapshot)),
          focalByType.get(type),
          now
        )
      ),
    [focalByType, now, providerTypes, snapshots, sortedEntries]
  );

  const groups = useMemo(() => {
    const visible =
      activeTab === 'all'
        ? sortedEntries
        : sortedEntries.filter((entry) => entry.type === activeTab);
    return QUOTA_TAB_ORDER.flatMap((type) => {
      const groupEntries = visible.filter((entry) => entry.type === type);
      if (groupEntries.length === 0) return [];
      const groupOverviews = groupEntries.map((entry) => overviews.get(entryKey(entry)) ?? null);
      return [
        {
          type,
          entries: groupEntries,
          columns: buildWindowColumns(type, groupOverviews, focalByType.get(type) ?? null),
          showResets:
            supportsManualReset(type) &&
            groupEntries.some((entry) => (resetCounts[getQuotaCacheKey(entry.file)] ?? 0) > 0),
        },
      ];
    });
  }, [activeTab, focalByType, overviews, resetCounts, sortedEntries]);

  // One page grid: the widest window set, then a manual-resets slot when any section has one.
  const slots =
    Math.max(1, ...groups.map((group) => group.columns.length)) +
    (groups.some((group) => group.showResets) ? 1 : 0);

  // Polling targets in a stable order, so a live re-sort never restarts the refresh loop.
  const pollItems = useMemo(
    () => [...entries].sort((a, b) => (entryKey(a) < entryKey(b) ? -1 : 1)),
    [entries]
  );

  const handleSelectProvider = useCallback(
    (type: QuotaProviderType) => {
      const next: QuotaTabId = activeTab === type ? 'all' : type;
      setTab(next);
      writeQuotaUiState({ tab: next });
    },
    [activeTab]
  );

  const handleFocalChange = useCallback((type: QuotaProviderType, windowId: string) => {
    setFocalPins((previous) => {
      const next = { ...previous, [type]: windowId };
      writeQuotaUiState({ focal: next });
      return next;
    });
  }, []);

  const toggleName = useCallback((key: string) => {
    setRevealed((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const handleSortModeChange = useCallback((next: string) => {
    setSortMode(next as QuotaSortMode);
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

  // Reload credentials before refreshing every quota.
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
      void loadQuota(pollItems);
    }
  }, [disableControls, error, filesGeneration, loading, loadQuota, pollItems, sessionGeneration]);

  const restoringQuota = useQuotaAutoRefresh(
    pollItems,
    disableControls || loading || Boolean(error) || filesGeneration !== sessionGeneration,
    loadQuota
  );

  const canUseActions = !disableControls && !loading && filesGeneration === sessionGeneration;
  // Only a user-initiated reload spins the header; first load shows skeletons instead.
  const refreshing = batchLoading || (loading && files.length > 0);

  const isEmpty = !loading && entries.length === 0;
  const hasData = entries.some((entry) => overviews.get(entryKey(entry)));
  const showSkeleton = (loading && files.length === 0) || (restoringQuota && !hasData);

  // Mutually exclusive account states, in lamp order; zero counts stay out of the header.
  const metaCounts: { key: string; value: number; lamp: LampState }[] = [
    { key: 'meta_serving', value: poolSummary.available, lamp: 'ok' },
    { key: 'meta_low', value: poolSummary.low, lamp: 'warn' },
    { key: 'meta_exhausted', value: poolSummary.exhausted, lamp: 'warn' },
    { key: 'meta_cooling', value: poolSummary.cooling, lamp: 'warn' },
    { key: 'meta_failing', value: poolSummary.failing, lamp: 'fault' },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('quota_management.page_title')}
        meta={
          <>
            <span>{t('quota_management.accounts', { count: entries.length })}</span>
            {poolSummary.observed &&
              metaCounts
                .filter((count) => count.value > 0)
                .map((count) => (
                  <Fragment key={count.key}>
                    <MetaDot />
                    <span className={styles.metaCount}>
                      <StatusLamp state={count.lamp} size={6} />
                      {t(`quota_management.${count.key}`, { count: count.value })}
                    </span>
                  </Fragment>
                ))}
          </>
        }
        actions={
          <>
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
          </>
        }
      />

      {error && (
        <div className={`error-box ${styles.listError}`} role="alert">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void loadFiles()}>
            {t('quota_management.retry')}
          </Button>
        </div>
      )}

      {showSkeleton ? (
        <div className={styles.skeleton} aria-hidden="true">
          <Skeleton height={164} rounded={8} />
          <Skeleton width={160} height={16} />
          <div className={styles.skeletonRows}>
            {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
              <Skeleton key={index} height={72} rounded={8} />
            ))}
          </div>
        </div>
      ) : isEmpty ? (
        <EmptyState
          title={t('quota_management.empty_title')}
          description={t('quota_management.empty_desc')}
        />
      ) : (
        <>
          <ProviderOverview
            summaries={providerSummaries}
            selected={activeTab === 'all' ? null : activeTab}
            filterable={filterable}
            now={now}
            onSelect={handleSelectProvider}
            onFocalChange={handleFocalChange}
          />

          <QuotaSections slots={slots}>
            {groups.map((group) => {
              const groupSnapshots = group.entries
                .map((entry) => snapshots.get(entryKey(entry)))
                .filter((snapshot): snapshot is AccountSnapshot => Boolean(snapshot));
              return (
                <QuotaSection
                  key={group.type}
                  type={group.type}
                  summary={buildGroupSummary(groupSnapshots, now)}
                  now={now}
                >
                  {group.entries.map((entry) => {
                    const key = entryKey(entry);
                    return (
                      <QuotaRow
                        key={key}
                        entry={entry}
                        quota={getQuota(entry)}
                        overview={overviews.get(key) ?? null}
                        columns={group.columns}
                        showResets={group.showResets}
                        cooldown={cooldowns.get(key) ?? null}
                        revealed={revealed.has(key)}
                        onToggleName={() => toggleName(key)}
                        canRefresh={canUseActions && !entry.file.disabled}
                        resetting={resettingQuotaName === getQuotaCacheKey(entry.file)}
                        onRefresh={() => refreshQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
                        onReset={() => resetQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
                        onResetCount={handleResetCount}
                      />
                    );
                  })}
                </QuotaSection>
              );
            })}
          </QuotaSections>
        </>
      )}
    </div>
  );
}

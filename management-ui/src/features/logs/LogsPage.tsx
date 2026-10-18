import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MetaDot, PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { lockScroll, unlockScroll } from '@/components/ui/scrollLock';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useAuthStore, useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { downloadBlob } from '@/utils/download';
import { INITIAL_VISIBLE_LINES } from './model/logBuffer';
import { createLogParserCache, filterLogEntries, searchLogEntries } from './model/logSelectors';
import type { LogState } from './model/logTypes';
import { formatUpdatedClock, type LevelThreshold } from './model/logDisplay';
import { shouldExitLogFullscreen } from './model/logFullscreen';
import { useLogStream } from './hooks/useLogStream';
import { useLogFilters } from './hooks/useLogFilters';
import { useLogFiles } from './hooks/useLogFiles';
import { isNearBottom, useLogScroller } from './hooks/useLogScroller';
import { logPanelDomId, logTabDomId, type LogTab } from './model/logTabs';
import { LogTabs } from './components/LogTabs';
import { LogToolbar } from './components/LogToolbar';
import { LogActiveFilters } from './components/LogActiveFilters';
import { LogViewer, type LogViewerEmpty } from './components/LogViewer';
import { LogStatusBar } from './components/LogStatusBar';
import { LogFileSheet } from './components/LogFileSheet';
import { ErrorFilesPanel } from './components/ErrorFilesPanel';
import styles from './LogsPage.module.scss';

const INITIAL_DISPLAY_LINES = INITIAL_VISIBLE_LINES;
const LOAD_MORE_LINES = 200;
/** Configuration deep link: opens the Logging section and highlights the "Log to file" row. */
const FILE_LOGGING_SETTING_PATH = '/config?field=loggingToFile';

export function LogsPage() {
  const { t, i18n } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [activeTab, setActiveTab] = useState<LogTab>('live');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [minLevel, setMinLevel] = useState<LevelThreshold>('');
  const [hideManagementLogs, setHideManagementLogs] = useLocalStorage(
    'logsPage.hideManagementLogs',
    true
  );
  const [showRawLogs, setShowRawLogs] = useLocalStorage('logsPage.showRawLogs', false);
  const [wrapLogs, setWrapLogs] = useLocalStorage('logsPage.wrapLogs', false);
  const [showIp, setShowIp] = useLocalStorage('logsPage.showIp', false);
  const [showSource, setShowSource] = useLocalStorage('logsPage.showSource', true);
  const [fullscreenLogs, setFullscreenLogs] = useState(false);

  const files = useLogFiles({ active: activeTab === 'errors' });

  const {
    logBuffer,
    visibleCount,
    setVisibleCount,
    lastUpdated,
    catchingUp,
    wasReset,
    loading,
    clearingLogs,
    error,
    autoRefresh,
    setAutoRefresh,
    cpaNeedsFileLogging,
    showFileLoggingRequired,
    loadLogs,
    clearLogs,
  } = useLogStream({
    active: activeTab === 'live',
    isFollowing: () => isNearBottom(logViewerRef.current),
    onFollow: () => requestScrollToBottom(),
  });

  const disableControls = connectionStatus !== 'connected';
  const refreshDisabled = disableControls || loading || clearingLogs || cpaNeedsFileLogging;
  const autoRefreshDisabled = disableControls || showFileLoggingRequired;
  const clearDisabled = disableControls || clearingLogs || showFileLoggingRequired;

  useHeaderRefresh(() => (activeTab === 'errors' ? files.loadErrorLogs() : loadLogs(false)));

  const downloadLogs = () => {
    const text = logBuffer.buffer.join('\n');
    downloadBlob({ filename: 'logs.txt', blob: new Blob([text], { type: 'text/plain' }) });
    showNotification(t('logs.download_success'), 'success');
  };

  const [parseEntries] = useState(createLogParserCache);
  const entries = useMemo(() => parseEntries(logBuffer), [logBuffer, parseEntries]);
  const trimmedSearchQuery = deferredSearchQuery.trim();
  const isSearching = trimmedSearchQuery.length > 0;
  const parsedSearchLines = useMemo(
    () => searchLogEntries(entries, trimmedSearchQuery, hideManagementLogs),
    [entries, trimmedSearchQuery, hideManagementLogs]
  );

  const filters = useLogFilters({ parsedLines: parsedSearchLines });

  const filteredParsedLines = useMemo(
    () =>
      filterLogEntries(parsedSearchLines, {
        methods: filters.methodFilterSet,
        statuses: filters.statusFilterSet,
        paths: filters.pathFilterSet,
        minLevel,
      }),
    [
      parsedSearchLines,
      filters.methodFilterSet,
      filters.statusFilterSet,
      filters.pathFilterSet,
      minLevel,
    ]
  );
  const filteredLines = useMemo(
    () => filteredParsedLines.map((line) => line.raw),
    [filteredParsedLines]
  );
  const logState = useMemo<LogState>(
    () => ({
      buffer: filteredLines,
      visibleFrom: Math.max(0, filteredLines.length - visibleCount),
    }),
    [filteredLines, visibleCount]
  );
  const setLogState: Dispatch<SetStateAction<LogState>> = (update) => {
    const next = typeof update === 'function' ? update(logState) : update;
    setVisibleCount(next.buffer.length - next.visibleFrom);
  };
  useEffect(() => {
    setVisibleCount(INITIAL_DISPLAY_LINES);
  }, [
    setVisibleCount,
    trimmedSearchQuery,
    hideManagementLogs,
    minLevel,
    filters.methodFilterSet,
    filters.statusFilterSet,
    filters.pathFilterSet,
  ]);
  const parsedVisibleLines = filteredParsedLines.slice(logState.visibleFrom);

  const {
    canLoadMore,
    handleLogScroll,
    logViewerRef,
    requestScrollToBottom,
    isFollowing,
    resumeFollowing,
    pendingLines,
    historyEvicted,
  } = useLogScroller({
    logState,
    setLogState,
    bufferStart: logBuffer.bufferStart,
    loading,
    isSearching,
    filteredLineCount: filteredLines.length,
    hasStructuredFilters: filters.hasStructuredFilters,
    showRawLogs,
    wrapLogs,
  });

  const copyLogLine = useCallback(
    async (raw: string) => {
      const ok = await copyToClipboard(raw);
      showNotification(
        ok
          ? t('logs.copy_success', { defaultValue: 'Copied to clipboard' })
          : t('logs.copy_failed', { defaultValue: 'Copy failed' }),
        ok ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );
  // Rows are memoized, so they get a stable callback that always calls the latest opener.
  const openRequestRef = useRef(files.openRequestLog);
  useLayoutEffect(() => {
    openRequestRef.current = files.openRequestLog;
  });
  const openRequest = useCallback(
    (requestId: string) => void openRequestRef.current(requestId),
    []
  );
  const copyLine = useCallback((raw: string) => void copyLogLine(raw), [copyLogLine]);

  const viewerOpen = files.viewer.status !== 'closed';
  useEffect(() => {
    if (!fullscreenLogs) return;

    document.body.classList.add('logs-fullscreen-active');
    lockScroll();

    const handleEscape = (event: KeyboardEvent) => {
      const overlayOpen = viewerOpen || !!document.querySelector('.modal-overlay');
      if (!shouldExitLogFullscreen(event, overlayOpen)) return;
      setFullscreenLogs(false);
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.classList.remove('logs-fullscreen-active');
      unlockScroll();
    };
  }, [fullscreenLogs, viewerOpen]);

  const clearAllFilters = () => {
    setSearchQuery('');
    setMinLevel('');
    filters.clearStructuredFilters();
  };

  const changeTab = (tab: LogTab) => {
    if (tab === 'errors') setFullscreenLogs(false);
    setActiveTab(tab);
  };

  const empty: LogViewerEmpty | null =
    loading && logBuffer.buffer.length === 0
      ? { kind: 'loading' }
      : logBuffer.buffer.length > 0 && filteredLines.length > 0
        ? null
        : logBuffer.buffer.length > 0
          ? {
              kind: 'message',
              text: t('logs.search_empty_title'),
              action: (
                <Button variant="secondary" size="sm" onClick={clearAllFilters}>
                  {t('logs.clear_filters')}
                </Button>
              ),
            }
          : showFileLoggingRequired
            ? {
                kind: 'message',
                text: t('logs.empty_logging_off'),
                action: (
                  <Link to={FILE_LOGGING_SETTING_PATH} className="btn btn-secondary btn-sm">
                    {t('logs.enable_file_logging')}
                  </Link>
                ),
              }
            : { kind: 'message', text: t('logs.empty_title'), detail: t('logs.empty_desc') };

  // Header meta mirrors the stream state so the header rhythm matches the other pages:
  // "154 lines · Live · updated 07:48:36" (live) or "5 files" (error requests).
  const updatedClock = formatUpdatedClock(lastUpdated, i18n.language);
  const readLabel = t(
    autoRefresh && catchingUp ? 'logs.catching_up' : autoRefresh ? 'logs.live' : 'logs.paused'
  );
  const headerMeta =
    activeTab === 'errors' ? (
      <span>
        {files.errorLogsLoaded
          ? t('logs.error_logs_count', { count: files.errorLogs.length })
          : t('logs.loading')}
      </span>
    ) : showFileLoggingRequired ? (
      <span>{t('logs.meta_file_logging_off')}</span>
    ) : loading && logBuffer.buffer.length === 0 ? (
      <span>{t('logs.loading')}</span>
    ) : (
      <>
        <span>{t('logs.meta_lines', { count: logBuffer.buffer.length })}</span>
        <MetaDot />
        <span>{readLabel}</span>
        {updatedClock ? (
          <>
            <MetaDot />
            <span>{t('logs.meta_updated', { time: updatedClock })}</span>
          </>
        ) : null}
      </>
    );
  const showStatusBar =
    logBuffer.buffer.length > 0 &&
    (filteredLines.length !== logBuffer.buffer.length ||
      wasReset ||
      historyEvicted ||
      wrapLogs ||
      showRawLogs);

  const toolbarActions = {
    onRefresh: () => void loadLogs(false),
    refreshDisabled,
    refreshing: loading && logBuffer.buffer.length > 0,
    onDownload: downloadLogs,
    downloadDisabled: logBuffer.buffer.length === 0,
    onClear: () => void clearLogs(),
    clearDisabled,
    fullscreen: fullscreenLogs,
    onToggleFullscreen: () => {
      const follow = isFollowing;
      setFullscreenLogs((prev) => !prev);
      // Resizing the viewer clamps scrollTop, which reads as scrolling up; keep following.
      if (follow) {
        window.requestAnimationFrame(() => window.requestAnimationFrame(requestScrollToBottom));
      }
    },
  };

  return (
    <div className={styles.container}>
      <PageHeader
        className={styles.header}
        title={t('nav.logs')}
        meta={headerMeta}
        tabs={
          <LogTabs
            active={activeTab}
            onChange={changeTab}
            errorFileCount={files.errorLogs.length}
          />
        }
      />

      {activeTab === 'live' ? (
        <div
          id={logPanelDomId('live')}
          role="tabpanel"
          aria-labelledby={logTabDomId('live')}
          className={[styles.workspace, fullscreenLogs ? styles.workspaceFullscreen : '']
            .filter(Boolean)
            .join(' ')}
        >
          <LogToolbar
            live={{
              enabled: autoRefresh,
              catchingUp,
              lastUpdated,
              disabled: autoRefreshDisabled,
              onToggle: () => setAutoRefresh(!autoRefresh),
            }}
            search={{
              value: searchQuery,
              onChange: setSearchQuery,
              matchCount: isSearching ? filteredLines.length : null,
            }}
            minLevel={minLevel}
            onMinLevelChange={setMinLevel}
            status={{
              active: filters.statusFilters,
              counts: filters.statusCounts,
              onToggle: filters.toggleStatusFilter,
            }}
            more={{
              methodFilters: filters.methodFilters,
              methodCounts: filters.methodCounts,
              onToggleMethod: filters.toggleMethodFilter,
              pathFilters: filters.pathFilters,
              pathOptions: filters.pathOptions,
              onTogglePath: filters.togglePathFilter,
              hasFilters: filters.hasStructuredFilters,
              onClearFilters: filters.clearStructuredFilters,
              display: {
                hideManagement: hideManagementLogs,
                setHideManagement: setHideManagementLogs,
                showIp,
                setShowIp,
                showSource,
                setShowSource,
                wrap: wrapLogs,
                setWrap: setWrapLogs,
                raw: showRawLogs,
                setRaw: setShowRawLogs,
              },
            }}
            actions={toolbarActions}
          />

          <LogActiveFilters
            methods={filters.methodFilters}
            paths={filters.pathFilters}
            onRemoveMethod={filters.toggleMethodFilter}
            onRemovePath={filters.togglePathFilter}
            onClearAll={filters.clearStructuredFilters}
          />

          {error ? (
            <div className={styles.streamError} role="alert">
              <span>{error}</span>
              <button
                type="button"
                className={styles.retry}
                onClick={() => void loadLogs(false)}
                disabled={refreshDisabled}
              >
                {t('common.refresh')}
              </button>
            </div>
          ) : null}

          <LogViewer
            viewerRef={logViewerRef}
            onScroll={handleLogScroll}
            empty={empty}
            loading={loading}
            lines={parsedVisibleLines}
            hiddenAbove={logState.visibleFrom}
            canLoadMore={canLoadMore}
            onLoadMore={() =>
              setVisibleCount((count) => Math.min(filteredLines.length, count + LOAD_MORE_LINES))
            }
            raw={showRawLogs}
            wrap={wrapLogs}
            showIp={showIp}
            showSource={showSource}
            query={trimmedSearchQuery}
            isFollowing={isFollowing}
            pendingLines={pendingLines}
            onResume={resumeFollowing}
            onOpenRequest={openRequest}
            onCopy={copyLine}
            statusBar={
              !showStatusBar ? null : (
                <LogStatusBar
                  cached={logBuffer.buffer.length}
                  matched={filteredLines.length}
                  cursorReset={wasReset}
                  historyEvicted={historyEvicted}
                  wrap={wrapLogs}
                  raw={showRawLogs}
                />
              )
            }
          />
        </div>
      ) : (
        <div
          id={logPanelDomId('errors')}
          role="tabpanel"
          aria-labelledby={logTabDomId('errors')}
          className={styles.workspace}
        >
          <ErrorFilesPanel
            files={files.errorLogs}
            loading={files.loadingErrors}
            loaded={files.errorLogsLoaded}
            error={files.errorLogsError}
            requestLogEnabled={files.requestLogEnabled}
            disabled={disableControls}
            onRefresh={() => void files.loadErrorLogs()}
            onOpen={(file) => void files.openLogFile(file)}
            onDownload={(name) => void files.downloadErrorLog(name)}
          />
        </div>
      )}

      <LogFileSheet
        viewer={files.viewer}
        requestId={files.viewerRequestId}
        downloading={files.requestLogDownloading}
        onClose={files.closeViewer}
        onCopy={() => void files.copyViewerText()}
        onDownload={files.downloadViewerFile}
      />
    </div>
  );
}

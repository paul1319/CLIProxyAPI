import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { MetaDot, PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { StatusLamp, type LampState } from '@/components/ui/StatusLamp';
import { useAuthStore, useQuotaStore } from '@/stores';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { formatRelativeInstant } from '@/utils/quota/relativeTime';
import { useDashboardOverview } from './hooks/useDashboardOverview';
import { useDashboardNow } from './hooks/useDashboardClock';
import { buildAttentionItems } from './attention';
import { collectQuotaReadings, summarizeQuota } from './quota';
import { providerIdOfAuthFile, splitWindowMinutes } from './utils';
import { PoolPanel } from './components/PoolPanel';
import { AttentionPanel } from './components/AttentionPanel';
import { ProviderTable } from './components/ProviderTable';
import { ThroughputPanel } from './components/ThroughputChart';
import { RuntimePanel } from './components/RuntimePanel';
import styles from './dashboard.module.scss';

const CONNECTION_LAMP: Record<string, LampState> = {
  connected: 'ok',
  connecting: 'warn',
  disconnected: 'fault',
};

/** "http://127.0.0.1:18317/" → "127.0.0.1:18317". */
const hostOf = (apiBase: string): string =>
  apiBase.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');

const formatServerVersion = (raw: string | null | undefined): string | null => {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return null;
  return /^\d/.test(trimmed) ? `v${trimmed}` : trimmed;
};

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const apiBase = useAuthStore((state) => state.apiBase);
  const now = useDashboardNow();

  const {
    connectionStatus,
    connected,
    config,
    counts,
    traffic,
    providers,
    authFiles,
    authFilesError,
    authFilesLoading,
    pool,
    updatedAt,
    reloadAuthFiles,
    refresh,
  } = useDashboardOverview();

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  useHeaderRefresh(handleRefresh, connected);

  const quotaSources = useQuotaStore(
    useShallow((state) => ({
      antigravityQuota: state.antigravityQuota,
      claudeQuota: state.claudeQuota,
      codexQuota: state.codexQuota,
      devinQuota: state.devinQuota,
      kimiQuota: state.kimiQuota,
      metaQuota: state.metaQuota,
      pluginQuota: state.pluginQuota,
      xaiQuota: state.xaiQuota,
    }))
  );

  const quotaReadings = useMemo(() => collectQuotaReadings(quotaSources), [quotaSources]);

  const quota = useMemo(
    () =>
      summarizeQuota(
        quotaReadings,
        (authFiles ?? []).map((file) => ({
          name: file.name,
          provider: providerIdOfAuthFile(file),
          disabled: file.disabled === true,
        })),
        now
      ),
    [quotaReadings, authFiles, now]
  );

  const attention = useMemo(
    () => (authFiles ? buildAttentionItems(authFiles, now) : []),
    [authFiles, now]
  );

  const windowLabel = useMemo(() => {
    const { hours, minutes } = splitWindowMinutes(traffic.windowMinutes);
    if (hours === 0) return t('dashboard.window_m', { minutes });
    if (minutes === 0) return t('dashboard.window_h', { hours });
    return t('dashboard.window_hm', { hours, minutes });
  }, [traffic.windowMinutes, t]);

  const freshness =
    updatedAt === null
      ? null
      : now - updatedAt < 60_000
        ? t('dashboard.updated_just_now')
        : t('dashboard.updated_ago', {
            time: formatRelativeInstant(updatedAt, now, i18n.language),
          });

  const version = formatServerVersion(serverVersion);
  const routing = config?.routingStrategy?.trim();
  const connectionText =
    connectionStatus === 'connected' && apiBase
      ? t('dashboard.meta_connected', { host: hostOf(apiBase) })
      : t(`common.${connectionStatus}_status`);

  const meta = (
    <>
      {version && (
        <>
          <span>{t('dashboard.meta_server', { version })}</span>
          <MetaDot />
        </>
      )}
      <span className={styles.metaConnection}>
        <StatusLamp state={CONNECTION_LAMP[connectionStatus] ?? 'idle'} size={6} />
        {connectionText}
      </span>
      {routing && (
        <>
          <MetaDot />
          <span className={styles.mono}>{routing}</span>
        </>
      )}
    </>
  );

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('nav.dashboard')}
        meta={meta}
        actions={
          <>
            {freshness && (
              <span className={styles.updated} aria-live="polite">
                {refreshing ? t('credentials.refreshing') : freshness}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={!connected || refreshing}
            >
              <IconRefreshCw size={14} className={refreshing ? styles.spinning : undefined} />
              {t('common.refresh')}
            </Button>
            <Link to="/logs" className="btn btn-ghost btn-sm">
              {t('dashboard.open_logs')}
            </Link>
          </>
        }
      />

      <PoolPanel
        connected={connected}
        pool={pool}
        loading={authFilesLoading}
        error={authFilesError}
        onRetry={() => void reloadAuthFiles()}
        traffic={traffic}
        windowLabel={windowLabel}
        quota={quota}
        now={now}
      />

      {attention.length > 0 && <AttentionPanel items={attention} />}

      {/* With no credentials and no API-key traffic the pool panel already says so. */}
      {(providers.length > 0 || (connected && authFiles === null && !authFilesError)) && (
        <ProviderTable providers={providers} quotaByProvider={quota.byProvider} now={now} />
      )}

      <ThroughputPanel traffic={traffic} windowLabel={windowLabel} />

      <RuntimePanel config={config} counts={counts} />
    </div>
  );
}

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Config } from '@/types';
import type { DashboardCounts } from '../types';
import styles from '../dashboard.module.scss';

interface RuntimePanelProps {
  config: Config | null;
  counts: DashboardCounts;
}

type RuntimeRow = { key: string; label: string; value: string | null; mono?: boolean };
type RuntimeToggle = { key: string; label: string; on: boolean | null };

export function RuntimePanel({ config, counts }: RuntimePanelProps) {
  const { t } = useTranslation();

  const routing = (() => {
    const raw = config?.routingStrategy?.trim() ?? '';
    if (!raw) return null;
    if (raw === 'round-robin') return t('basic_settings.routing_strategy_round_robin');
    if (raw === 'weighted-round-robin') {
      return t('basic_settings.routing_strategy_weighted_round_robin');
    }
    if (raw === 'fill-first') return t('basic_settings.routing_strategy_fill_first');
    if (raw === 'reset-first') return t('basic_settings.routing_strategy_reset_first');
    return raw;
  })();

  const rows: RuntimeRow[] = [
    { key: 'routing', label: t('dashboard.runtime_routing'), value: routing },
    {
      key: 'retry',
      label: t('dashboard.runtime_retry'),
      value: config ? String(config.requestRetry ?? 0) : null,
    },
    {
      key: 'proxy',
      label: t('dashboard.runtime_proxy'),
      value: config?.proxyUrl?.trim() || null,
      mono: true,
    },
    {
      key: 'management',
      label: t('dashboard.runtime_management_keys'),
      value: counts.managementKeys === null ? null : String(counts.managementKeys),
    },
    {
      key: 'providerKeys',
      label: t('dashboard.runtime_provider_keys'),
      value: counts.providerKeys === null ? null : String(counts.providerKeys),
    },
  ];

  const toggles: RuntimeToggle[] = [
    { key: 'debug', label: t('dashboard.runtime_debug'), on: config ? !!config.debug : null },
    {
      key: 'fileLogging',
      label: t('dashboard.runtime_file_logging'),
      on: config ? !!config.loggingToFile : null,
    },
    {
      key: 'requestLog',
      label: t('dashboard.runtime_request_log'),
      on: config ? !!config.requestLog : null,
    },
    { key: 'wsAuth', label: t('dashboard.runtime_ws_auth'), on: config ? !!config.wsAuth : null },
    {
      key: 'modelPrefix',
      label: t('dashboard.runtime_model_prefix'),
      on: config ? !!config.forceModelPrefix : null,
    },
  ];

  return (
    <section className={styles.panel} aria-labelledby="overview-runtime-title">
      <header className={styles.panelHeader}>
        <h2 id="overview-runtime-title" className={styles.panelTitle}>
          {t('dashboard.runtime_title')}
        </h2>
        <Link
          to="/config"
          className="btn btn-ghost btn-sm"
          aria-label={t('dashboard.runtime_link')}
          title={t('dashboard.runtime_link')}
        >
          {t('common.edit')}
        </Link>
      </header>
      {/* Two even columns: values on the left, switches on the right. */}
      <div className={styles.kvColumns}>
        <dl className={styles.kvList}>
          {rows.map((row) => (
            <div key={row.key} className={styles.kvRow}>
              <dt className={styles.kvLabel}>{row.label}</dt>
              <dd className={`${styles.kvValue} ${row.mono && row.value ? styles.mono : ''}`}>
                {row.value ?? <span className={styles.dash}>—</span>}
              </dd>
            </div>
          ))}
        </dl>
        <dl className={styles.kvList}>
          {toggles.map((toggle) => (
            <div key={toggle.key} className={styles.kvRow}>
              <dt className={styles.kvLabel}>{toggle.label}</dt>
              <dd className={`${styles.kvValue} ${toggle.on === false ? styles.kvOff : ''}`}>
                {toggle.on === null ? (
                  <span className={styles.dash}>—</span>
                ) : toggle.on ? (
                  t('dashboard.runtime_on')
                ) : (
                  t('dashboard.runtime_off')
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

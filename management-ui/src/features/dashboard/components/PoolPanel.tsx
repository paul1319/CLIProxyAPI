import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusLamp, type LampState } from '@/components/ui/StatusLamp';
import { IconArrowRight } from '@/components/ui/icons';
import type { PoolSummary } from '@/components/layout/poolRail';
import { formatPercent } from '@/utils/format';
import type { TrafficWindow } from '../types';
import type { QuotaOverview } from '../quota';
import { providerLabel, toneForSuccessRate, type MeterTone } from '../utils';
import { useDurationFormatter } from '../hooks/useDashboardClock';
import styles from '../dashboard.module.scss';

const RATE_LAMP: Record<MeterTone, LampState> = {
  good: 'ok',
  warning: 'warn',
  critical: 'fault',
  idle: 'idle',
};

interface PoolPanelProps {
  connected: boolean;
  pool: PoolSummary | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  traffic: TrafficWindow;
  windowLabel: string;
  quota: QuotaOverview;
  now: number;
}

export function PoolPanel({
  connected,
  pool,
  loading,
  error,
  onRetry,
  traffic,
  windowLabel,
  quota,
  now,
}: PoolPanelProps) {
  const { t } = useTranslation();
  const formatDuration = useDurationFormatter();
  const unknownProvider = t('dashboard.provider_unknown');

  const stateLabels: Record<LampState, string> = {
    ok: t('dashboard.state_serving'),
    warn: t('dashboard.state_cooling'),
    fault: t('dashboard.state_failing'),
    idle: t('dashboard.state_disabled'),
  };

  const errorBar = error ? (
    <div className={styles.inlineError} role="alert">
      <span className={styles.inlineErrorText}>
        <strong>
          {pool ? t('dashboard.pool_refresh_failed') : t('dashboard.pool_load_error')}
        </strong>
        {error !== 'unknown' && <span className={styles.inlineErrorDetail}>{error}</span>}
      </span>
      <Button variant="secondary" size="sm" onClick={onRetry} loading={loading}>
        {t('dashboard.retry')}
      </Button>
    </div>
  ) : null;

  let main: ReactNode;
  if (!connected) {
    main = (
      <div className={styles.poolNotice}>
        <p className={styles.poolNoticeTitle}>{t('dashboard.pool_offline_title')}</p>
        <p className={styles.poolNoticeHint}>{t('dashboard.pool_offline_hint')}</p>
      </div>
    );
  } else if (!pool) {
    main = error ? null : (
      <div className={styles.poolSkeleton} aria-busy="true">
        <Skeleton width={320} height={28} rounded={6} />
        <Skeleton width={180} height={10} rounded={5} />
        <Skeleton width={240} height={12} rounded={4} />
      </div>
    );
  } else if (pool.total === 0) {
    main = (
      <div className={styles.poolNotice}>
        <p className={styles.poolNoticeTitle}>{t('dashboard.pool_empty_title')}</p>
        <p className={styles.poolNoticeHint}>{t('dashboard.pool_empty_hint')}</p>
        <Link to="/oauth" className="btn btn-secondary btn-sm">
          {t('nav.oauth')}
        </Link>
      </div>
    );
  } else {
    // `summarizePool` already orders ok → warn → fault → idle, exactly like the sidebar rail.
    const lamps = pool.lamps;
    const breakdown = [
      { state: 'warn' as const, count: pool.cooling },
      { state: 'fault' as const, count: pool.failing },
      { state: 'idle' as const, count: pool.disabled },
    ].filter((entry) => entry.count > 0);
    const healthy = pool.cooling === 0 && pool.failing === 0;

    main = (
      <>
        <p className={styles.poolStatement}>
          <Trans
            i18nKey="dashboard.pool_serving"
            values={{ serving: pool.serving, total: pool.total }}
            components={{ num: <span className={styles.poolFigure} /> }}
          />
        </p>
        <ul className={styles.lampRow} aria-label={t('dashboard.pool_lamps_label')}>
          {lamps.map((lamp) => (
            <li key={lamp.id} className={styles.lampCell}>
              <StatusLamp
                state={lamp.state}
                size={10}
                label={`${lamp.label} · ${stateLabels[lamp.state]}`}
              />
            </li>
          ))}
        </ul>
        <ul className={styles.breakdown}>
          {healthy && (
            <li className={styles.breakdownItem}>
              <StatusLamp state="ok" size={6} />
              {t('dashboard.pool_all_healthy')}
            </li>
          )}
          {breakdown.map((entry) => (
            <li key={entry.state} className={styles.breakdownItem}>
              <StatusLamp state={entry.state} size={6} />
              {stateLabels[entry.state]}
              <span className={styles.breakdownCount}>{entry.count}</span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const hasTraffic = traffic.total > 0;
  const rateTone = toneForSuccessRate(traffic.successRate);
  // One "no requests" note is enough; the other figures stay quiet until there is a window.
  const windowCaption =
    traffic.windowMinutes > 0 ? t('dashboard.figure_window', { window: windowLabel }) : null;

  let nextResetValue: ReactNode = <span className={styles.dash}>—</span>;
  let nextResetCaption: ReactNode = connected ? (
    <Link to="/quota" className={styles.textLink}>
      {t('dashboard.quota_not_loaded')}
    </Link>
  ) : null;
  if (quota.nextReset) {
    nextResetValue = t('dashboard.next_reset_value', {
      time: formatDuration(quota.nextReset.atMs - now),
    });
    nextResetCaption = t('dashboard.next_reset_caption', {
      provider: providerLabel(quota.nextReset.provider, unknownProvider),
      percent: formatPercent(quota.nextReset.remaining * 100, 0),
    });
  } else if (quota.known) {
    nextResetCaption = t('dashboard.next_reset_none');
  }

  return (
    <section className={styles.pool} aria-labelledby="overview-pool-title">
      <div className={styles.poolHead}>
        <h2 id="overview-pool-title" className="overline">
          {t('dashboard.pool_title')}
        </h2>
        {connected && (
          <Link to="/auth-files" className={styles.headLink}>
            {t('nav.auth_files')}
            <IconArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className={styles.poolMain}>
        {errorBar}
        {main}
      </div>

      <dl className={styles.figures}>
        <div className={styles.figure}>
          <dt className={styles.figureLabel}>{t('dashboard.success_rate')}</dt>
          <dd className={styles.figureValue}>
            {hasTraffic && traffic.successRate !== null ? (
              <>
                <StatusLamp state={RATE_LAMP[rateTone]} size={8} />
                {formatPercent(traffic.successRate)}
              </>
            ) : (
              <span className={styles.dash}>—</span>
            )}
          </dd>
          <dd className={styles.figureCaption}>
            {windowCaption ?? (connected ? t('dashboard.figure_no_traffic') : null)}
          </dd>
        </div>
        <div className={styles.figure}>
          <dt className={styles.figureLabel}>{t('dashboard.figure_requests')}</dt>
          <dd className={styles.figureValue}>
            {connected ? traffic.total.toLocaleString() : <span className={styles.dash}>—</span>}
          </dd>
          <dd className={styles.figureCaption}>{windowCaption}</dd>
        </div>
        <div className={styles.figure}>
          <dt className={styles.figureLabel}>{t('dashboard.figure_failures')}</dt>
          <dd className={styles.figureValue}>
            {connected ? (
              traffic.totalFailure.toLocaleString()
            ) : (
              <span className={styles.dash}>—</span>
            )}
          </dd>
          <dd className={styles.figureCaption}>
            {hasTraffic
              ? t('dashboard.figure_failure_share', {
                  percent: formatPercent((traffic.totalFailure / traffic.total) * 100),
                })
              : windowCaption}
          </dd>
        </div>
        <div className={styles.figure}>
          <dt className={styles.figureLabel}>{t('dashboard.figure_next_reset')}</dt>
          <dd className={styles.figureValue}>{nextResetValue}</dd>
          <dd className={styles.figureCaption}>{nextResetCaption}</dd>
        </div>
      </dl>
    </section>
  );
}

import { useTranslation } from 'react-i18next';
import { Meter } from '@/components/ui/Meter';
import { toneForRemaining } from '@/components/ui/meterTone';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusLamp } from '@/components/ui/StatusLamp';
import { getAuthFileIcon } from '@/features/authFiles/constants';
import { useThemeStore } from '@/stores';
import { formatPercent } from '@/utils/format';
import type { ProviderTraffic } from '../types';
import type { QuotaReading } from '../quota';
import { providerLabel, toneForSuccessRate } from '../utils';
import { useDurationFormatter } from '../hooks/useDashboardClock';
import { Sparkline } from './Sparkline';
import styles from '../dashboard.module.scss';

interface ProviderTableProps {
  providers: ProviderTraffic[];
  quotaByProvider: Map<string, QuotaReading>;
  now: number;
}

const RATE_CLASS = {
  good: '',
  warning: styles.rateWarn,
  critical: styles.rateFault,
  idle: '',
} as const;

export function ProviderTable({ providers, quotaByProvider, now }: ProviderTableProps) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const formatDuration = useDurationFormatter();
  const unknownProvider = t('dashboard.provider_unknown');
  const dash = <span className={styles.dash}>—</span>;

  return (
    <section className={styles.panel} aria-labelledby="overview-providers-title">
      <header className={styles.panelHeader}>
        <h2 id="overview-providers-title" className={styles.panelTitle}>
          {t('dashboard.providers_title')}
        </h2>
      </header>
      {providers.length === 0 ? (
        // Only rendered empty while credentials load; the page hides the panel otherwise.
        <div className={styles.tableSkeleton} aria-busy="true">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} height={16} rounded={4} />
          ))}
        </div>
      ) : (
        <table className={styles.providerTable}>
          <thead>
            <tr>
              <th scope="col">{t('dashboard.col_provider')}</th>
              <th scope="col">{t('dashboard.col_accounts')}</th>
              <th scope="col">{t('dashboard.col_issues')}</th>
              <th scope="col" className={styles.numCol}>
                {t('dashboard.col_requests')}
              </th>
              <th scope="col" className={styles.numCol}>
                {t('dashboard.col_success')}
              </th>
              <th scope="col">{t('dashboard.col_quota')}</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => {
              const name = providerLabel(provider.id, unknownProvider);
              const icon = getAuthFileIcon(provider.id, resolvedTheme);
              const quota = quotaByProvider.get(provider.id);
              const quotaTone = quota ? toneForRemaining(quota.remaining) : 'idle';
              const rateTone = toneForSuccessRate(provider.successRate);
              return (
                <tr key={provider.id}>
                  <th scope="row" className={styles.providerCell}>
                    <span className={styles.providerGlyph} aria-hidden="true">
                      {icon ? <img src={icon} alt="" /> : name.charAt(0)}
                    </span>
                    <span className={styles.providerName}>{name}</span>
                  </th>
                  <td data-label={t('dashboard.col_accounts')}>
                    {provider.accounts > 0 ? (
                      <span className={styles.tabular}>
                        {provider.serving}
                        <span className={styles.ofTotal}> / {provider.accounts}</span>
                      </span>
                    ) : null}
                    {provider.apiKeys > 0 && (
                      <span className={styles.subtle}>
                        {provider.accounts > 0 ? ' · ' : ''}
                        {t('dashboard.api_keys_count', { count: provider.apiKeys })}
                      </span>
                    )}
                  </td>
                  <td data-label={t('dashboard.col_issues')}>
                    {provider.failing === 0 && provider.cooling === 0 ? (
                      dash
                    ) : (
                      <span className={styles.issues}>
                        {provider.failing > 0 && (
                          <span className={styles.issue}>
                            <StatusLamp state="fault" size={6} />
                            {t('dashboard.issues_failing', { count: provider.failing })}
                          </span>
                        )}
                        {provider.cooling > 0 && (
                          <span className={styles.issue}>
                            <StatusLamp state="warn" size={6} />
                            {t('dashboard.issues_cooling', { count: provider.cooling })}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td data-label={t('dashboard.col_requests')} className={styles.numCol}>
                    <span className={styles.requestsCell}>
                      <Sparkline
                        points={provider.buckets.map((bucket) => bucket.success + bucket.failed)}
                        ariaLabel={t('dashboard.provider_spark_label', { provider: name })}
                      />
                      <span className={styles.tabular}>{provider.total.toLocaleString()}</span>
                    </span>
                  </td>
                  <td
                    data-label={t('dashboard.col_success')}
                    className={`${styles.numCol} ${RATE_CLASS[rateTone]}`}
                  >
                    {provider.successRate === null ? (
                      dash
                    ) : (
                      <span className={styles.tabular}>{formatPercent(provider.successRate)}</span>
                    )}
                  </td>
                  <td data-label={t('dashboard.col_quota')}>
                    {quota ? (
                      <span className={styles.quotaCell} data-tone={quotaTone}>
                        <Meter
                          value={quota.remaining}
                          tone={quotaTone}
                          ariaLabel={`${name} ${t('dashboard.col_quota')}`}
                          className={styles.quotaMeter}
                        />
                        <span className={styles.quotaValue}>
                          {formatPercent(quota.remaining * 100, 0)}
                        </span>
                        {quota.resetAtMs !== null && (
                          <span className={styles.subtle}>
                            {t('dashboard.quota_resets', {
                              time: formatDuration(quota.resetAtMs - now),
                            })}
                          </span>
                        )}
                      </span>
                    ) : (
                      dash
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

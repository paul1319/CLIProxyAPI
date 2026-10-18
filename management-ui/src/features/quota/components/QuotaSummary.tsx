/** Pool capacity strip: accounts serving now, the next capacity return, and what needs attention. */

import { useTranslation } from 'react-i18next';
import { StatusLamp, type LampState } from '@/components/ui/StatusLamp';
import { Skeleton } from '@/components/ui/Skeleton';
import type { AccountSnapshot, PoolSummary } from '../poolSummary';
import { formatCompactDuration, formatFullInstant } from '../format';
import styles from './QuotaSummary.module.scss';

interface QuotaSummaryProps {
  summary: PoolSummary;
  now: number;
  loading: boolean;
}

const segmentTitle = (
  account: AccountSnapshot,
  t: ReturnType<typeof useTranslation>['t']
): string => {
  const state = t(`quota_management.state_${account.state}`);
  const hero = account.hero;
  if (!hero || hero.remaining === null) return `${account.name} · ${state}`;
  return `${account.name} · ${state} · ${Math.round(hero.remaining)}% · ${hero.label}`;
};

export function QuotaSummary({ summary, now, loading }: QuotaSummaryProps) {
  const { t, i18n } = useTranslation();

  if (loading) {
    return (
      <section className={styles.summary} aria-hidden="true">
        <div className={styles.capacity}>
          <Skeleton width={96} height={12} />
          <Skeleton width={72} height={32} />
          <Skeleton height={6} />
        </div>
        <div className={styles.next}>
          <Skeleton width={120} height={12} />
          <Skeleton width={96} height={22} />
        </div>
      </section>
    );
  }

  // Mutually exclusive account states, in lamp order (warn before fault), then resets.
  const counts: { key: string; label: string; value: number; lamp?: LampState }[] = [
    { key: 'low', label: t('quota_management.summary_low'), value: summary.low, lamp: 'warn' },
    {
      key: 'exhausted',
      label: t('quota_management.summary_exhausted'),
      value: summary.exhausted,
      lamp: 'warn',
    },
    {
      key: 'cooling',
      label: t('quota_management.summary_cooling'),
      value: summary.cooling,
      lamp: 'warn',
    },
    {
      key: 'failing',
      label: t('quota_management.summary_failing'),
      value: summary.failing,
      lamp: 'fault',
    },
    { key: 'resets', label: t('quota_management.summary_resets'), value: summary.resets },
  ];

  return (
    <section className={styles.summary} aria-label={t('quota_management.summary_label')}>
      <div className={styles.capacity}>
        <span className={styles.label}>{t('quota_management.summary_available')}</span>
        <p
          className={styles.figure}
          aria-label={t('quota_management.summary_available_aria', {
            available: summary.available,
            total: summary.total,
          })}
        >
          <span className={styles.figureValue}>{summary.observed ? summary.available : '—'}</span>
          <span className={styles.figureTotal}>/ {summary.total}</span>
        </p>
        {summary.total > 0 && (
          <div className={styles.segments} aria-hidden="true">
            {summary.segments.map((account) => (
              <span
                key={account.key}
                className={styles.segment}
                data-tone={account.tone}
                title={segmentTitle(account, t)}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.next}>
        <span className={styles.label}>{t('quota_management.summary_next')}</span>
        {summary.next ? (
          <>
            <p
              className={styles.nextValue}
              title={formatFullInstant(summary.next.atMs, i18n.resolvedLanguage)}
            >
              {t('quota_management.summary_in', {
                duration: formatCompactDuration(t, summary.next.atMs - now),
              })}
            </p>
            <p className={styles.nextMeta} title={`${summary.next.name} · ${summary.next.label}`}>
              <span className={styles.nextName}>{summary.next.name}</span>
              <span className={styles.nextWindow}>{summary.next.label}</span>
            </p>
          </>
        ) : (
          <p className={styles.nextNone}>
            {summary.observed ? t('quota_management.summary_next_none') : '—'}
          </p>
        )}
      </div>

      <dl className={styles.counts}>
        {counts.map((count) => (
          <div key={count.key} className={styles.count} data-zero={count.value === 0 || undefined}>
            <dt>
              {count.lamp ? (
                <StatusLamp state={count.value > 0 ? count.lamp : 'idle'} size={6} />
              ) : (
                <span className={styles.lampSpacer} aria-hidden="true" />
              )}
              {count.label}
            </dt>
            <dd>{count.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

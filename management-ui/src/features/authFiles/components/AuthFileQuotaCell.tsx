import { useTranslation } from 'react-i18next';
import { Meter } from '@/components/ui/Meter';
import { toneForRemaining } from '@/components/ui/meterTone';
import { IconRefreshCw } from '@/components/ui/icons';
import type { QuotaCardState } from '@/features/quota/providers';
import { useNow } from '@/hooks/useNow';
import type { AuthFileItem } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import type { QuotaProviderType } from '@/features/authFiles/constants';
import { formatCompactDuration, type QuotaHeadline } from '@/features/authFiles/quotaSummary';
import styles from './AuthFilesTable.module.scss';

export type AuthFileQuotaCellProps = {
  file: AuthFileItem;
  /** Null when the provider exposes no quota (or the credential is runtime-only). */
  quotaType: QuotaProviderType | null;
  quota: QuotaCardState | undefined;
  headline: QuotaHeadline | null;
  canRefresh: boolean;
  onRefresh: () => void;
};

/**
 * Tightest quota window as one meter + "62% · 3h". Tone follows the console-wide
 * `toneForRemaining` rule (green ≥60%, yellow 25–60%, red <25%). Unknown states render an
 * em dash; the refresh affordance appears on row hover/focus.
 */
export function AuthFileQuotaCell({
  file,
  quotaType,
  quota,
  headline,
  canRefresh,
  onRefresh,
}: AuthFileQuotaCellProps) {
  const { t, i18n } = useTranslation();
  const now = useNow(Boolean(headline?.resetAtMs));

  if (!quotaType || file.disabled === true) {
    return <span className={styles.dash}>—</span>;
  }

  const refreshButton = (
    <button
      type="button"
      className={styles.quotaRefresh}
      onClick={onRefresh}
      disabled={!canRefresh || quota?.status === 'loading'}
      title={t('auth_files.quota_refresh_single')}
      aria-label={t('auth_files.quota_refresh_single')}
    >
      <IconRefreshCw size={13} />
    </button>
  );

  if (quota?.status === 'loading') {
    return (
      <span className={styles.quota} aria-busy="true">
        <span className={styles.quotaMeter}>
          <Meter value={null} ariaLabel={t('common.loading')} />
        </span>
        <span className={styles.quotaPending}>…</span>
      </span>
    );
  }

  if (quota?.status === 'error') {
    const message = resolveQuotaErrorMessage(
      t,
      quota.errorStatus,
      quota.error || t('common.unknown_error')
    );
    return (
      <span className={styles.quota}>
        <span className={styles.quotaError} title={message}>
          {quota.errorStatus
            ? t('credentials.quota_error_status', { status: quota.errorStatus })
            : t('credentials.quota_error')}
        </span>
        {refreshButton}
      </span>
    );
  }

  if (!headline) {
    return (
      <span className={styles.quota}>
        <span className={styles.dash}>—</span>
        {refreshButton}
      </span>
    );
  }

  const percent = Math.round(headline.remaining * 100);
  const reset =
    headline.resetAtMs !== null
      ? formatCompactDuration(headline.resetAtMs - now, i18n.resolvedLanguage)
      : null;
  const tone = toneForRemaining(headline.remaining);
  const description = reset
    ? t('credentials.quota_cell_title_reset', {
        label: headline.label,
        percent,
        time: reset,
      })
    : t('credentials.quota_cell_title', { label: headline.label, percent });

  return (
    <span className={styles.quota} title={description} data-tone={tone}>
      <span className={styles.quotaMeter}>
        <Meter value={headline.remaining} tone={tone} ariaLabel={description} />
      </span>
      <span className={styles.quotaText}>
        <span className={styles.quotaPercent}>{percent}%</span>
        {reset && <span className={styles.quotaResetIn}>· {reset}</span>}
      </span>
      {refreshButton}
    </span>
  );
}

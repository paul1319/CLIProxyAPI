import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import type { QuotaCardState } from '../providers';

export function QuotaFreshness({ quota }: { quota?: QuotaCardState }) {
  const { t, i18n } = useTranslation();
  const now = useNow(Boolean(quota?.observedAt));
  const observedAt = quota?.observedAt ? Date.parse(quota.observedAt) : NaN;
  if (!Number.isFinite(observedAt)) return null;
  const seconds = Math.max(0, Math.floor((now - observedAt) / 1000));
  const unit = seconds < 60 ? 'second' : seconds < 3600 ? 'minute' : 'hour';
  const amount =
    unit === 'second'
      ? seconds
      : unit === 'minute'
        ? Math.floor(seconds / 60)
        : Math.floor(seconds / 3600);
  const time = new Intl.RelativeTimeFormat(i18n.resolvedLanguage, { numeric: 'auto' }).format(
    -amount,
    unit
  );
  return (
    <div role="status" title={new Date(observedAt).toLocaleString(i18n.resolvedLanguage)}>
      {t(quota?.stale ? 'quota_management.snapshot_stale' : 'quota_management.snapshot_updated', {
        time,
      })}
      {quota?.persistenceError && <div>{t('quota_management.snapshot_save_failed')}</div>}
    </div>
  );
}

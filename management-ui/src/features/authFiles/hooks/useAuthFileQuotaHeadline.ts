import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { buildAccountOverview } from '@/features/quota/accountCardModel';
import { QUOTA_ADAPTERS, type QuotaCardState } from '@/features/quota/providers';
import type { QuotaStore } from '@/features/quota/providers/types';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaProviderType } from '@/features/authFiles/constants';
import { pickTightestLimit, type QuotaHeadline } from '@/features/authFiles/quotaSummary';

/** Quota observation + tightest window for one credential row's quota cell. */
export function useAuthFileQuotaHeadline(
  file: AuthFileItem,
  quotaType: QuotaProviderType | null
): { quota: QuotaCardState | undefined; headline: QuotaHeadline | null } {
  const { t, i18n } = useTranslation();
  const cacheKey = getQuotaCacheKey(file);
  const quota = useQuotaStore((state) =>
    quotaType
      ? QUOTA_ADAPTERS[quotaType].storeSelector(state as unknown as QuotaStore)[cacheKey]
      : undefined
  );
  const headline = useMemo(
    () =>
      quotaType && quota?.status === 'success'
        ? pickTightestLimit(buildAccountOverview(quotaType, quota, t, i18n.resolvedLanguage).limits)
        : null,
    [i18n.resolvedLanguage, quota, quotaType, t]
  );
  return { quota, headline };
}

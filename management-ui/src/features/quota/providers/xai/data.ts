/** Read-only xAI billing and subscription observations. Quota reads never run inference. */

import { quotaApi, type QuotaReadOptions } from '@/services/api/quota';

import type { TFunction } from 'i18next';
import type { AuthFileItem, XaiBillingSummary, XaiQuotaState } from '@/types';
import { getApiCallErrorMessage } from '@/services/api';
import {
  normalizeStringValue,
  parseXaiBillingPayload,
  buildXaiBillingSummary,
  mergeXaiBillingSummaries,
  resolveXaiSubscriptionPlan,
  createStatusError,
  isDisabledAuthFile,
  isXaiFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

const toXaiRecord = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const requestXaiBilling = async (
  authIndex: string,
  resource: 'weekly' | 'monthly',
  options?: QuotaReadOptions
): Promise<XaiBillingSummary | null> => {
  const result = await quotaApi.read(authIndex, resource, options);

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseXaiBillingPayload(result.body ?? result.bodyText);
  return buildXaiBillingSummary(payload?.config);
};

const readJsonRecord = (result: { statusCode: number; body?: unknown; bodyText?: string }) => {
  if (result.statusCode < 200 || result.statusCode >= 300) return null;
  const body = result.body ?? result.bodyText;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as unknown;
      return toXaiRecord(parsed);
    } catch {
      return null;
    }
  }
  return toXaiRecord(body);
};

const readPlanField = (record: Record<string, unknown> | null, keys: string[]) => {
  if (!record) return null;
  for (const key of keys) {
    const value = normalizeStringValue(record[key]);
    if (value) return value;
  }
  return null;
};

const requestXaiSubscription = async (authIndex: string, options?: QuotaReadOptions) => {
  const [userResult, settingsResult] = await Promise.allSettled([
    quotaApi.read(authIndex, 'user', options),
    quotaApi.read(authIndex, 'settings', options),
  ]);
  const user = userResult.status === 'fulfilled' ? readJsonRecord(userResult.value) : null;
  const settings =
    settingsResult.status === 'fulfilled' ? readJsonRecord(settingsResult.value) : null;
  return resolveXaiSubscriptionPlan(
    readPlanField(user, ['subscriptionTier', 'subscription_tier']),
    readPlanField(settings, ['subscription_tier_display', 'subscriptionTierDisplay'])
  );
};

const withSubscriptionPlan = (
  summary: XaiBillingSummary,
  plan: { label: string; tier: 'elite' | 'premium' | 'standard' } | null
): XaiBillingSummary => {
  if (!plan) return summary;
  return { ...summary, planLabel: plan.label, planTier: plan.tier };
};

const fetchXaiQuota = async (
  file: AuthFileItem,
  t: TFunction,
  options: QuotaReadOptions = {}
): Promise<XaiBillingSummary> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('xai_quota.missing_auth_index'));
  }

  const [weeklyResult, monthlyResult] = await Promise.allSettled([
    requestXaiBilling(authIndex, 'weekly', options),
    requestXaiBilling(authIndex, 'monthly', options),
  ]);
  const weeklySummary = weeklyResult.status === 'fulfilled' ? weeklyResult.value : null;
  const monthlySummary = monthlyResult.status === 'fulfilled' ? monthlyResult.value : null;
  const summary = mergeXaiBillingSummaries(weeklySummary, monthlySummary);
  if (summary) return summary;

  const billingError =
    weeklyResult.status === 'rejected' && monthlyResult.status === 'rejected'
      ? weeklyResult.reason
      : new Error(t('xai_quota.empty_data'));

  throw billingError;
};

export const XAI_CONFIG: QuotaProviderData<XaiQuotaState, XaiBillingSummary> = {
  type: 'xai',
  i18nPrefix: 'xai_quota',
  filterFn: (file) => isXaiFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchXaiQuota,
  enrichQuota: async (file, summary, _t, options) => {
    const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
    if (!authIndex) return summary;
    return withSubscriptionPlan(summary, await requestXaiSubscription(authIndex, options));
  },
  storeSelector: (state) => state.xaiQuota,
  storeSetter: 'setXaiQuota',
  buildLoadingState: () => ({ status: 'loading', billing: null }),
  buildSuccessState: (billing) => ({ status: 'success', billing }),
  buildErrorState: (message, status) => ({
    status: 'error',
    billing: null,
    error: message,
    errorStatus: status,
  }),
};

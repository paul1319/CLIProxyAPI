/** Antigravity quota groups and independently cached subscription metadata. */

import { quotaApi, type QuotaReadOptions } from '@/services/api/quota';

import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaGroup,
  AntigravityQuotaSubscription,
  AntigravityQuotaSummaryPayload,
  AntigravityQuotaState,
  AuthFileItem,
} from '@/types';
import { getApiCallErrorMessage } from '@/services/api';
import { parseAntigravitySubscriptionSummary } from '@/services/api/antigravitySubscription';
import {
  parseAntigravityPayload,
  buildAntigravityQuotaGroups,
  createStatusError,
  isAntigravityFile,
  isDisabledAuthFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

export type AntigravityQuotaData = {
  groups: AntigravityQuotaGroup[];
  subscription: AntigravityQuotaSubscription | null;
  serverTimeOffsetMs: number | null;
};

const fetchAntigravityQuota = async (
  file: AuthFileItem,
  t: TFunction,
  options: QuotaReadOptions = {}
): Promise<AntigravityQuotaData> => {
  const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
  if (!authIndex) throw new Error(t('antigravity_quota.missing_auth_index'));
  const [result, subscription] = await Promise.all([
    quotaApi.read(authIndex, 'usage', options),
    quotaApi
      .read(authIndex, 'subscription', options)
      .then((value) =>
        value.statusCode === 200 ? parseAntigravitySubscriptionSummary(value.body) : null
      )
      .catch(() => null),
  ]);
  if (result.statusCode < 200 || result.statusCode >= 300)
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  const payload = parseAntigravityPayload(result.body) as AntigravityQuotaSummaryPayload | null;
  if (!payload || !Array.isArray(payload.groups))
    throw new Error(t('antigravity_quota.empty_models'));
  return {
    groups: buildAntigravityQuotaGroups(payload),
    subscription,
    serverTimeOffsetMs: result.header.Date?.[0]
      ? Date.parse(result.header.Date[0]) - Date.now()
      : null,
  };
};

export const ANTIGRAVITY_CONFIG: QuotaProviderData<AntigravityQuotaState, AntigravityQuotaData> = {
  type: 'antigravity',
  i18nPrefix: 'antigravity_quota',
  filterFn: (file) => isAntigravityFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchAntigravityQuota,
  storeSelector: (state) => state.antigravityQuota,
  storeSetter: 'setAntigravityQuota',
  buildLoadingState: () => ({
    status: 'loading',
    groups: [],
    subscription: null,
    serverTimeOffsetMs: null,
  }),
  buildSuccessState: (data) => ({
    status: 'success',
    groups: data.groups,
    subscription: data.subscription,
    serverTimeOffsetMs: data.serverTimeOffsetMs,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    groups: [],
    subscription: null,
    serverTimeOffsetMs: null,
    error: message,
    errorStatus: status,
  }),
};

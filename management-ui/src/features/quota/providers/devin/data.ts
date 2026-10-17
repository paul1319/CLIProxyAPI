import type { TFunction } from 'i18next';
import type { DevinQuotaData, DevinQuotaState } from '@/types';
import { quotaApi } from '@/services/api/quota';
import { readDevinQuotaResponse, hasDevinQuotaObservation } from '@/services/api/devinQuota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isDevinFile, isDisabledAuthFile, createStatusError } from '@/utils/quota';
import type { QuotaProviderData } from '../types';

const withLabels = (quota: DevinQuotaData, t: TFunction): DevinQuotaData => ({
  ...quota,
  windows: quota.windows.map((window) => ({
    ...window,
    label: t(`devin_quota.${window.id}`),
  })),
});

const emptyData = (): DevinQuotaData => ({
  windows: [],
  observedAtMs: null,
  plan: null,
  planStartMs: null,
  planEndMs: null,
});

export const DEVIN_CONFIG: QuotaProviderData<DevinQuotaState, DevinQuotaData> = {
  type: 'devin',
  i18nPrefix: 'devin_quota',
  filterFn: (file) => isDevinFile(file) && !isDisabledAuthFile(file),
  fetchQuota: async (file, t, options) => {
    const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
    if (!authIndex) throw new Error(t('devin_quota.missing_identity'));
    const response = await quotaApi.read(authIndex, 'usage', options);
    if (response.statusCode !== 200)
      throw createStatusError('Quota read failed', response.statusCode);
    const quota = readDevinQuotaResponse(
      response.body,
      options?.observedAt ? Date.parse(options.observedAt) : Date.now()
    );
    if (!hasDevinQuotaObservation(quota)) throw new Error(t('devin_quota.empty_data'));
    return withLabels(quota, t);
  },
  storeSelector: (state) => state.devinQuota,
  storeSetter: 'setDevinQuota',
  buildLoadingState: () => ({ status: 'loading', ...emptyData() }),
  buildSuccessState: (data) => ({ status: 'success', ...data }),
  buildErrorState: (error, errorStatus) => ({
    status: 'error',
    ...emptyData(),
    error,
    errorStatus,
  }),
};

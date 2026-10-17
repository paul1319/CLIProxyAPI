import type { TFunction } from 'i18next';
import type { MetaQuotaData, MetaQuotaState } from '@/types';
import { quotaApi } from '@/services/api/quota';
import { parseMetaQuotaPayload } from '@/services/api/metaQuota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isDisabledAuthFile, resolveAuthProvider } from '@/utils/quota';
import type { QuotaProviderData } from '../types';

export const META_CONFIG: QuotaProviderData<MetaQuotaState, MetaQuotaData> = {
  type: 'meta',
  i18nPrefix: 'meta_quota',
  filterFn: (file) => resolveAuthProvider(file) === 'meta' && !isDisabledAuthFile(file),
  fetchQuota: async (file, t: TFunction, options) => {
    const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
    if (!authIndex) throw new Error(t('meta_quota.missing_auth_index'));
    const result = await quotaApi.read(authIndex, 'usage', options);
    if (result.statusCode !== 200)
      throw new Error(t('meta_quota.request_failed', { status: result.statusCode }));
    const quota = parseMetaQuotaPayload(result.body);
    if (!quota) throw new Error(t('meta_quota.invalid_response'));
    return quota;
  },
  storeSelector: (state) => state.metaQuota,
  storeSetter: 'setMetaQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: (data) => ({ status: 'success', data }),
  buildErrorState: (error, errorStatus) => ({
    status: 'error',
    error,
    errorStatus,
  }),
};

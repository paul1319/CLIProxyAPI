import type { TFunction } from 'i18next';
import { loadQuotaEntry } from '@/features/quota/quotaRequests';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores';
import type { AuthFileItem } from '@/types';
import type { QuotaProviderType } from './constants';

type Notify = (message: string, type: 'success' | 'error') => void;

/**
 * Force one credential's quota read and report the outcome, unless the quota cache was
 * invalidated meanwhile (connection switch, file mutation) — then stay silent.
 */
export async function forceRefreshAuthFileQuota(
  file: AuthFileItem,
  quotaType: QuotaProviderType,
  t: TFunction,
  notify: Notify
): Promise<void> {
  const cacheGeneration = captureQuotaCacheGeneration(file.name);
  try {
    await loadQuotaEntry(file, QUOTA_ADAPTERS[quotaType], t, { mode: 'force' });
    commitIfQuotaCacheCurrent(cacheGeneration, () => {
      notify(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : t('common.unknown_error');
    commitIfQuotaCacheCurrent(cacheGeneration, () => {
      notify(t('auth_files.quota_refresh_failed', { name: file.name, message }), 'error');
    });
  }
}

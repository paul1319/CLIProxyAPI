import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuotaReadOptions } from '@/services/api/quota';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS } from '../providers';
import { isVisibleQuotaLoad, loadQuotaEntry } from '../quotaRequests';

/**
 * Batch quota reads for a page of cards.
 *
 * Manual and background batches are tracked separately: a background poll
 * must neither spin the toolbar nor swallow a user's "Refresh all" that lands
 * while it is in flight (per-entry requests are still shared in loadQuotaEntry).
 */
export function useQuotaBatchLoader() {
  const { t } = useTranslation();
  const [batchLoading, setBatchLoading] = useState(false);
  const manualRunning = useRef(false);
  const backgroundRunning = useRef(false);
  const loadQuota = useCallback(
    async (targets: QuotaFileEntry[], options: QuotaReadOptions = { mode: 'force' }) => {
      const visible = isVisibleQuotaLoad(options);
      const running = visible ? manualRunning : backgroundRunning;
      if (running.current || targets.length === 0) return;
      running.current = true;
      if (visible) setBatchLoading(true);
      try {
        await Promise.all(
          targets.map(({ file, type }) =>
            loadQuotaEntry(file, QUOTA_ADAPTERS[type], t, options).catch(() => {})
          )
        );
      } finally {
        running.current = false;
        if (visible) setBatchLoading(false);
      }
    },
    [t]
  );
  return { batchLoading, loadQuota };
}

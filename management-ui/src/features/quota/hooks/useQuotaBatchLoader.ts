import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuotaReadOptions } from '@/services/api/quota';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_LOAD_CONCURRENCY } from '../constants';
import { QUOTA_ADAPTERS } from '../providers';
import { isVisibleQuotaLoad, loadQuotaEntry } from '../quotaRequests';

/** Run `task` over `items` with at most `limit` in flight; failures are the task's to handle. */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Batch quota reads for every listed credential, QUOTA_LOAD_CONCURRENCY at a time.
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
        // Cached reads never reach the upstream, so only live reads are throttled.
        const limit = options.mode === 'cached' ? targets.length : QUOTA_LOAD_CONCURRENCY;
        await runWithConcurrency(targets, limit, ({ file, type }) =>
          loadQuotaEntry(file, QUOTA_ADAPTERS[type], t, options).catch(() => {})
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

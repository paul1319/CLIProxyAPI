import { useEffect, useRef, useState } from 'react';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { QuotaReadOptions } from '@/services/api/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import { startQuotaRefresh } from '../quotaRefresh';

type Loader = (entries: QuotaFileEntry[], options?: QuotaReadOptions) => Promise<void>;

/** Visible views restore durable observations before requesting due refreshes. */
export function useQuotaAutoRefresh(entries: QuotaFileEntry[], disabled: boolean, load: Loader) {
  const generation = useQuotaStore((state) => state.cacheGeneration);
  const fileGenerations = useQuotaStore((state) => state.fileGenerations);
  const currentEntries = useRef(entries);
  useEffect(() => {
    currentEntries.current = entries;
  }, [entries]);
  const identity = JSON.stringify(
    entries.map(({ type, file }) => [type, getQuotaCacheKey(file), fileGenerations[file.name] ?? 0])
  );
  const restoreKey = JSON.stringify([generation, identity]);
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  useEffect(() => {
    if (disabled || currentEntries.current.length === 0) return;
    let current = true;
    const loop = startQuotaRefresh({
      load: async (options) => {
        await load(currentEntries.current, options);
        if (current && options.mode === 'cached') setRestoredKey(restoreKey);
      },
      visible: () => document.visibilityState !== 'hidden',
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer),
    });
    document.addEventListener('visibilitychange', loop.visibilityChanged);
    return () => {
      current = false;
      loop.stop();
      document.removeEventListener('visibilitychange', loop.visibilityChanged);
    };
  }, [disabled, restoreKey, load]);
  return !disabled && entries.length > 0 && restoredKey !== restoreKey;
}

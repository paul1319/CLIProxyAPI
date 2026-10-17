import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuotaReadOptions } from '@/services/api/quota';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS } from '../providers';
import { loadQuotaEntry } from '../quotaRequests';

export function useQuotaBatchLoader() {
  const { t } = useTranslation();
  const [batchLoading, setBatchLoading] = useState(false);
  const loading = useRef(false);
  const loadQuota = useCallback(
    async (targets: QuotaFileEntry[], options: QuotaReadOptions = { mode: 'force' }) => {
      if (loading.current || targets.length === 0) return;
      loading.current = true;
      if (options.mode !== 'cached') setBatchLoading(true);
      try {
        await Promise.all(
          targets.map(({ file, type }) =>
            loadQuotaEntry(file, QUOTA_ADAPTERS[type], t, options).catch(() => {})
          )
        );
      } finally {
        loading.current = false;
        setBatchLoading(false);
      }
    },
    [t]
  );
  return { batchLoading, loadQuota };
}

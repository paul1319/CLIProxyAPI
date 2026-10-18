import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFilesApi } from '@/services/api';
import { useAuthStore, useConfigStore } from '@/stores';
import { useInterval } from '@/hooks/useInterval';
import { useProviderRecentRequests } from '@/components/providers/hooks/useProviderRecentRequests';
import { getCredentialLampState, summarizePool } from '@/components/layout/poolRail';
import { AUTH_FILES_CHANGED_EVENT } from '@/features/authFiles/authFilesEvents';
import {
  mergeRecentRequestBucketGroups,
  normalizeRecentRequestUsageEntry,
  type RecentRequestBucket,
} from '@/utils/recentRequests';
import type { Config } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import {
  TRAFFIC_BUCKET_MINUTES,
  type DashboardCounts,
  type ProviderTraffic,
  type TrafficWindow,
} from '../types';
import { providerIdOfAuthFile } from '../utils';

/** Credentials change state (cooldowns, failures) far faster than the 240s usage poll. */
const AUTH_FILES_POLL_MS = 60_000;

const EMPTY_TRAFFIC: TrafficWindow = {
  buckets: [],
  totalSuccess: 0,
  totalFailure: 0,
  total: 0,
  successRate: null,
  peakTotal: 0,
  peakIndex: -1,
  windowMinutes: 0,
};

/** `api-key-usage` keys look like `<baseUrl>|<apiKey>`; take everything after the first separator. */
const apiKeyFromCompositeKey = (compositeKey: string): string => {
  const separatorIndex = compositeKey.indexOf('|');
  return separatorIndex < 0 ? '' : compositeKey.slice(separatorIndex + 1).trim();
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

const buildTrafficWindow = (bucketGroups: RecentRequestBucket[][]): TrafficWindow => {
  const buckets = mergeRecentRequestBucketGroups(bucketGroups);
  if (buckets.length === 0) {
    return EMPTY_TRAFFIC;
  }

  let totalSuccess = 0;
  let totalFailure = 0;
  let peakTotal = 0;
  let peakIndex = -1;

  buckets.forEach((bucket, index) => {
    const bucketTotal = bucket.success + bucket.failed;
    totalSuccess += bucket.success;
    totalFailure += bucket.failed;
    if (bucketTotal > peakTotal) {
      peakTotal = bucketTotal;
      peakIndex = index;
    }
  });

  const total = totalSuccess + totalFailure;

  return {
    buckets,
    totalSuccess,
    totalFailure,
    total,
    successRate: total > 0 ? (totalSuccess / total) * 100 : null,
    peakTotal,
    peakIndex,
    windowMinutes: buckets.length * TRAFFIC_BUCKET_MINUTES,
  };
};

interface ProviderAccumulator {
  accounts: number;
  serving: number;
  failing: number;
  cooling: number;
  apiKeys: number;
  bucketGroups: RecentRequestBucket[][];
}

const createAccumulator = (): ProviderAccumulator => ({
  accounts: 0,
  serving: 0,
  failing: 0,
  cooling: 0,
  apiKeys: 0,
  bucketGroups: [],
});

export const getProviderKeyCounts = (config: Config) => ({
  gemini: config.geminiApiKeys?.length ?? 0,
  interactions: config.interactionsApiKeys?.length ?? 0,
  codex: config.codexApiKeys?.length ?? 0,
  meta: config.metaApiKeys?.length ?? 0,
  xai: config.xaiApiKeys?.length ?? 0,
  claude: config.claudeApiKeys?.length ?? 0,
  vertex: config.vertexApiKeys?.length ?? 0,
  openai: config.openaiCompatibility?.length ?? 0,
});

/**
 * Everything the overview shows.
 *
 * Traffic has two non-overlapping sources: `api-key-usage` (config-inline API key
 * credentials) and `auth-files` (file/runtime credentials). The backend keeps them
 * mutually exclusive, but plugin-provided credentials could in theory appear in both,
 * so accounts are de-duplicated defensively by `account_type` + `account`.
 */
export function useDashboardOverview() {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  const connected = connectionStatus === 'connected';

  const { usageByProvider, refreshRecentRequests } = useProviderRecentRequests({
    enabled: connected,
  });

  const [authFiles, setAuthFiles] = useState<AuthFileItem[] | null>(null);
  const [authFilesError, setAuthFilesError] = useState<string | null>(null);
  const [authFilesLoading, setAuthFilesLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const requestIdRef = useRef(0);

  const loadAuthFiles = useCallback(async () => {
    if (!connected) return;
    const requestId = ++requestIdRef.current;
    setAuthFilesLoading(true);
    try {
      const response = await authFilesApi.list();
      if (requestId !== requestIdRef.current) return;
      setAuthFiles(Array.isArray(response?.files) ? response.files : []);
      setAuthFilesError(null);
      setUpdatedAt(Date.now());
    } catch (error: unknown) {
      if (requestId !== requestIdRef.current) return;
      // Keep the last good list: a failed refresh is not "no credentials".
      setAuthFilesError(errorText(error) || 'unknown');
    } finally {
      if (requestId === requestIdRef.current) setAuthFilesLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    if (!connected) return;
    void fetchConfig().catch(() => undefined);
    void loadAuthFiles();
  }, [connected, fetchConfig, loadAuthFiles]);

  useEffect(() => {
    const handleChanged = () => void loadAuthFiles();
    window.addEventListener(AUTH_FILES_CHANGED_EVENT, handleChanged);
    return () => window.removeEventListener(AUTH_FILES_CHANGED_EVENT, handleChanged);
  }, [loadAuthFiles]);

  useInterval(
    () => {
      if (document.visibilityState === 'visible') void loadAuthFiles();
    },
    connected ? AUTH_FILES_POLL_MS : null
  );

  const refresh = useCallback(async () => {
    if (!connected) return;
    await Promise.allSettled([fetchConfig(true), loadAuthFiles(), refreshRecentRequests()]);
  }, [connected, fetchConfig, loadAuthFiles, refreshRecentRequests]);

  const providerKeyCounts = useMemo(() => (config ? getProviderKeyCounts(config) : null), [config]);

  const { traffic, providers } = useMemo(() => {
    const accumulators = new Map<string, ProviderAccumulator>();
    const allBucketGroups: RecentRequestBucket[][] = [];
    const apiKeysFromUsage = new Set<string>();

    const accumulatorFor = (providerId: string): ProviderAccumulator => {
      const existing = accumulators.get(providerId);
      if (existing) return existing;
      const created = createAccumulator();
      accumulators.set(providerId, created);
      return created;
    };

    usageByProvider.forEach((entriesByKey, providerId) => {
      const accumulator = accumulatorFor(providerId);
      entriesByKey.forEach((entry, compositeKey) => {
        const apiKey = apiKeyFromCompositeKey(compositeKey);
        if (apiKey) {
          apiKeysFromUsage.add(apiKey);
        }
        accumulator.apiKeys += 1;
        if (entry.recentRequests.length > 0) {
          accumulator.bucketGroups.push(entry.recentRequests);
          allBucketGroups.push(entry.recentRequests);
        }
      });
    });

    (authFiles ?? []).forEach((file) => {
      const accountType = String(file.account_type ?? '')
        .trim()
        .toLowerCase();
      const account = String(file.account ?? '').trim();
      // Credentials already counted through api-key-usage are not counted twice.
      if (accountType === 'api_key' && account && apiKeysFromUsage.has(account)) {
        return;
      }

      const accumulator = accumulatorFor(providerIdOfAuthFile(file));
      const lamp = getCredentialLampState(file);
      const entry = normalizeRecentRequestUsageEntry(file);
      accumulator.accounts += 1;
      if (lamp === 'ok') accumulator.serving += 1;
      if (lamp === 'fault') accumulator.failing += 1;
      if (lamp === 'warn') accumulator.cooling += 1;
      if (entry.recentRequests.length > 0) {
        accumulator.bucketGroups.push(entry.recentRequests);
        allBucketGroups.push(entry.recentRequests);
      }
    });

    const providerRows: ProviderTraffic[] = Array.from(accumulators.entries())
      .map(([id, accumulator]) => {
        const buckets = mergeRecentRequestBucketGroups(accumulator.bucketGroups);
        // Window totals come from the buckets so every column covers the same span.
        let success = 0;
        let failure = 0;
        buckets.forEach((bucket) => {
          success += bucket.success;
          failure += bucket.failed;
        });
        const total = success + failure;
        return {
          id,
          accounts: accumulator.accounts,
          serving: accumulator.serving,
          failing: accumulator.failing,
          cooling: accumulator.cooling,
          apiKeys: accumulator.apiKeys,
          success,
          failure,
          total,
          successRate: total > 0 ? (success / total) * 100 : null,
          buckets,
        };
      })
      .sort(
        (a, b) =>
          b.total - a.total ||
          b.accounts + b.apiKeys - (a.accounts + a.apiKeys) ||
          a.id.localeCompare(b.id)
      );

    return {
      traffic: buildTrafficWindow(allBucketGroups),
      providers: providerRows,
    };
  }, [usageByProvider, authFiles]);

  const pool = useMemo(() => (authFiles ? summarizePool(authFiles) : null), [authFiles]);

  const counts = useMemo<DashboardCounts>(
    () => ({
      managementKeys: config ? (config.apiKeys?.length ?? 0) : null,
      providerKeys: providerKeyCounts
        ? Object.values(providerKeyCounts).reduce((sum, count) => sum + count, 0)
        : null,
    }),
    [config, providerKeyCounts]
  );

  return {
    connectionStatus,
    connected,
    config,
    counts,
    providerKeyCounts,
    traffic,
    providers,
    authFiles,
    authFilesError,
    authFilesLoading,
    pool,
    updatedAt,
    reloadAuthFiles: loadAuthFiles,
    refresh,
  };
}

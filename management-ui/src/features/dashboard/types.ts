import type { RecentRequestBucket } from '@/utils/recentRequests';

/** Minutes covered by one traffic bucket (the backend reports 20 × 10-minute buckets). */
export const TRAFFIC_BUCKET_MINUTES = 10;

/** Aggregated traffic window across every credential. */
export interface TrafficWindow {
  buckets: RecentRequestBucket[];
  totalSuccess: number;
  totalFailure: number;
  total: number;
  /** 0–100; null when the window holds no requests. */
  successRate: number | null;
  /** Largest single-bucket request count, used for the chart axis. */
  peakTotal: number;
  /** Index of the peak bucket; -1 when there is no data. */
  peakIndex: number;
  /** Window length in minutes. */
  windowMinutes: number;
}

/** One provider's slice of the pool and its traffic. */
export interface ProviderTraffic {
  id: string;
  /** Credential files (OAuth / runtime accounts) for this provider. */
  accounts: number;
  /** Accounts whose lamp is `ok`. */
  serving: number;
  /** Accounts that are unavailable or erroring. */
  failing: number;
  /** Accounts benched by a credential-wide cooldown. */
  cooling: number;
  /** Config-inline API keys that reported usage for this provider. */
  apiKeys: number;
  success: number;
  failure: number;
  total: number;
  successRate: number | null;
  buckets: RecentRequestBucket[];
}

/** Raw counts shown in the runtime panel. */
export interface DashboardCounts {
  managementKeys: number | null;
  providerKeys: number | null;
}

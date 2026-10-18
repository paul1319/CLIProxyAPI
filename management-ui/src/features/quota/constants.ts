import type { QuotaProviderType } from './providers/types';

/** Provider order for tabs and for the provider sections of the quota page. */
export const QUOTA_TAB_ORDER: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
  'devin',
  'meta',
  'plugin',
];

export type QuotaTabId = 'all' | QuotaProviderType;

/** Quota reads in flight at once; the page lists every credential, so batches are throttled. */
export const QUOTA_LOAD_CONCURRENCY = 6;

/**
 * Row order inside each provider section: name (stable default), least
 * remaining in the provider's focal window first, or soonest return first.
 */
export const QUOTA_SORT_MODES = ['name', 'remaining', 'soonest'] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

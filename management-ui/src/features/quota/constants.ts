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

/** Fixed page size of 20, which also caps "Refresh all" upstream concurrency at 20. */
export const QUOTA_PAGE_SIZE = 20;

/**
 * Card order inside each provider section: name (stable default), least
 * remaining capacity first, or soonest capacity return first.
 */
export const QUOTA_SORT_MODES = ['name', 'remaining', 'soonest'] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

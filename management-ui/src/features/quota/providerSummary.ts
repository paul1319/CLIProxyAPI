/**
 * Provider-level capacity for the quota overview strip.
 *
 * Every rate-limit window is summed across a provider's credentials, so
 * "409% of 500%" reads as "about four accounts' worth left". The focal window
 * is the one with the smallest share left — model-scoped windows included —
 * unless the operator pinned another one.
 *
 * Pure and React-free, like poolSummary: the strip, the table columns and the
 * sort order all derive from the same per-account overviews.
 */

import type { AccountLimit, AccountOverview } from './accountCardModel';
import { isServing, type AccountSnapshot } from './poolSummary';
import type { QuotaProviderType } from './providers/types';
import { orderWindowRows } from './windowRows';

export interface WindowAggregate {
  id: string;
  label: string;
  /** Sum of remaining percent over the credentials that report this window. */
  remaining: number;
  /** 100 per reporting credential. */
  capacity: number;
}

export interface ProviderSegment {
  key: string;
  /** Remaining percent in the focal window; null when the credential does not report it. */
  remaining: number | null;
}

export interface ProviderSummary {
  type: QuotaProviderType;
  count: number;
  serving: number;
  cooling: number;
  failing: number;
  /** Manual resets the provider's credentials can spend. */
  resets: number;
  /** Summable windows: whole-account ones first, then model-scoped ones. */
  windows: WindowAggregate[];
  focal: WindowAggregate | null;
  /** One segment per credential, in the order the table lists them. */
  segments: ProviderSegment[];
  /** Soonest focal-window reset among credentials that have spent some of it. */
  nextReturnAtMs: number | null;
}

/** Display label of a window; pooled providers prefix the model pool. */
export const limitLabel = (limit: Pick<AccountLimit, 'label' | 'pool'>): string =>
  limit.pool ? `${limit.pool} · ${limit.label}` : limit.label;

export const findLimit = (overview: AccountOverview | null, id: string | null) =>
  id === null ? null : (overview?.limits.find((limit) => limit.id === id) ?? null);

/** Spend caps are money, not capacity, so they never join the sums. */
export function aggregateWindows(
  overviews: readonly (AccountOverview | null)[]
): WindowAggregate[] {
  const representatives: AccountLimit[] = [];
  const sums = new Map<string, { remaining: number; capacity: number }>();
  for (const overview of overviews) {
    for (const limit of overview?.limits ?? []) {
      if (limit.scope === 'spend') continue;
      let sum = sums.get(limit.id);
      if (!sum) {
        sum = { remaining: 0, capacity: 0 };
        sums.set(limit.id, sum);
        representatives.push(limit);
      }
      if (limit.remaining === null) continue;
      sum.remaining += limit.remaining;
      sum.capacity += 100;
    }
  }
  return orderWindowRows(representatives).flatMap((limit) => {
    const sum = sums.get(limit.id);
    if (!sum || sum.capacity === 0) return [];
    return [{ id: limit.id, label: limitLabel(limit), ...sum }];
  });
}

/** The pinned window when it still exists, otherwise the smallest share left (first wins ties). */
export function pickFocalWindow(
  windows: readonly WindowAggregate[],
  pinnedId?: string | null
): WindowAggregate | null {
  const pinned = pinnedId ? windows.find((window) => window.id === pinnedId) : undefined;
  if (pinned) return pinned;
  let best: WindowAggregate | null = null;
  for (const window of windows) {
    if (best === null || window.remaining / window.capacity < best.remaining / best.capacity) {
      best = window;
    }
  }
  return best;
}

export function buildProviderSummary(
  type: QuotaProviderType,
  accounts: readonly AccountSnapshot[],
  pinnedId: string | null | undefined,
  nowMs: number
): ProviderSummary {
  const windows = aggregateWindows(accounts.map((account) => account.overview));
  const focal = pickFocalWindow(windows, pinnedId);
  let nextReturnAtMs: number | null = null;
  let resets = 0;
  const segments = accounts.map((account): ProviderSegment => {
    const limit = findLimit(account.overview, focal?.id ?? null);
    const remaining = limit?.remaining ?? null;
    const atMs = limit?.resetAtMs ?? null;
    if (remaining !== null && remaining < 100 && atMs !== null && atMs > nowMs) {
      if (nextReturnAtMs === null || atMs < nextReturnAtMs) nextReturnAtMs = atMs;
    }
    if (account.resets !== null && account.resets > 0) resets += account.resets;
    return { key: account.key, remaining };
  });
  return {
    type,
    count: accounts.length,
    serving: accounts.filter(isServing).length,
    cooling: accounts.filter((account) => account.state === 'cooling').length,
    failing: accounts.filter((account) => account.state === 'failing').length,
    resets,
    windows,
    focal,
    segments,
    nextReturnAtMs,
  };
}

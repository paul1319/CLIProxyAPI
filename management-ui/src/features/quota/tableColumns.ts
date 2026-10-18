/**
 * Window columns of a provider section in the quota table.
 *
 * Columns line up across a section's rows: the focal window first, then the
 * rest in scope order (whole-account windows, then model-scoped ones), capped
 * at MAX_WINDOW_COLUMNS. Pooled providers (Antigravity, plugins) get one
 * column per model pool showing that pool's tightest window. Spend caps and
 * anything past the cap stay in the row's expandable detail.
 */

import {
  POOLED_PROVIDERS,
  pickHeroLimit,
  type AccountLimit,
  type AccountOverview,
} from './accountCardModel';
import type { QuotaProviderType } from './providers/types';
import { orderWindowRows } from './windowRows';

export const MAX_WINDOW_COLUMNS = 3;

/** Window columns plus the manual-resets column never exceed this many slots. */
export const MAX_TABLE_SLOTS = MAX_WINDOW_COLUMNS + 1;

export interface WindowColumn {
  id: string;
  /** Shown in cells of rows that do not report this window. */
  label: string;
  /** Model pool shown by this column; null for per-window columns. */
  pool: string | null;
}

const rateLimits = (overview: AccountOverview | null): AccountLimit[] =>
  (overview?.limits ?? []).filter((limit) => limit.scope !== 'spend');

export function buildWindowColumns(
  type: QuotaProviderType,
  overviews: readonly (AccountOverview | null)[],
  focalId: string | null
): WindowColumn[] {
  const limits = overviews.flatMap(rateLimits);
  const focal = limits.find((limit) => limit.id === focalId);
  if (POOLED_PROVIDERS.has(type)) {
    const pools: string[] = [];
    for (const limit of limits) {
      const pool = limit.pool ?? '';
      if (!pools.includes(pool)) pools.push(pool);
    }
    const focalPool = focal ? (focal.pool ?? '') : null;
    return pools
      .sort((a, b) => Number(b === focalPool) - Number(a === focalPool))
      .slice(0, MAX_WINDOW_COLUMNS)
      .map((pool) => ({ id: `pool:${pool}`, label: pool, pool }));
  }
  const unique = [...new Map(limits.map((limit) => [limit.id, limit])).values()];
  return orderWindowRows(unique)
    .sort((a, b) => Number(b.id === focalId) - Number(a.id === focalId))
    .slice(0, MAX_WINDOW_COLUMNS)
    .map((limit) => ({ id: limit.id, label: limit.label, pool: null }));
}

/** The window a row shows in a column; a pool column shows the pool's tightest window. */
export function pickColumnLimit(
  column: WindowColumn,
  overview: AccountOverview | null
): AccountLimit | null {
  const limits = rateLimits(overview);
  if (column.pool === null) return limits.find((limit) => limit.id === column.id) ?? null;
  const pooled = limits.filter((limit) => (limit.pool ?? '') === column.pool);
  return pickHeroLimit(pooled) ?? pooled[0] ?? null;
}

/** Everything a row reports beyond its column cells, in row order. */
export function hiddenLimits(
  columns: readonly WindowColumn[],
  overview: AccountOverview | null
): AccountLimit[] {
  const shown = new Set(
    columns.map((column) => pickColumnLimit(column, overview)?.id).filter(Boolean)
  );
  return orderWindowRows((overview?.limits ?? []).filter((limit) => !shown.has(limit.id)));
}

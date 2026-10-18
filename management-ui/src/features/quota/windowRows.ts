/** Pure helpers for a quota card's window rows. */

import { toneForRemaining, type MeterTone } from '@/components/ui/meterTone';
import type { AccountLimit, LimitScope } from './accountCardModel';

/** Rows shown before the "+N more" toggle. */
export const VISIBLE_WINDOW_ROWS = 4;

/** Remaining percent (0–100) as the 0–1 fraction the shared meter takes. */
export const percentToFraction = (remaining: number | null | undefined): number | null =>
  remaining === null || remaining === undefined || Number.isNaN(remaining)
    ? null
    : Math.min(100, Math.max(0, remaining)) / 100;

/** The shared meter rule (toneForRemaining) for a remaining percentage. */
export function toneForPercent(remaining: number | null): MeterTone {
  return toneForRemaining(percentToFraction(remaining));
}

const SCOPE_ORDER: Record<LimitScope, number> = { gating: 0, scoped: 1, spend: 2 };

/** Gating windows first, then model-scoped ones, then spend caps; list order inside each. */
export function orderWindowRows(limits: readonly AccountLimit[]): AccountLimit[] {
  return limits
    .map((limit, index) => ({ limit, index }))
    .sort((a, b) => SCOPE_ORDER[a.limit.scope] - SCOPE_ORDER[b.limit.scope] || a.index - b.index)
    .map(({ limit }) => limit);
}

/**
 * Row-level quota headline: the single tightest window of a credential.
 * React-free — consumed by tests/authFileRow.test.ts.
 */

import type { AccountLimit } from '@/features/quota/accountCardModel';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

/** Pay-as-you-go spend caps are not plan headroom; they never headline a row. */
const NON_HEADLINE_LIMIT_IDS = new Set(['extra-usage', 'xai-on-demand']);

export type QuotaHeadline = {
  label: string;
  /** Remaining capacity, 0–1. */
  remaining: number;
  resetAtMs: number | null;
};

/** Lowest remaining window; ties go to the window that resets first. */
export function pickTightestLimit(limits: readonly AccountLimit[]): QuotaHeadline | null {
  let best: AccountLimit | null = null;
  for (const limit of limits) {
    if (limit.remaining === null || !Number.isFinite(limit.remaining)) continue;
    if (NON_HEADLINE_LIMIT_IDS.has(limit.id)) continue;
    if (
      best === null ||
      best.remaining === null ||
      limit.remaining < best.remaining ||
      (limit.remaining === best.remaining &&
        (limit.resetAtMs ?? Infinity) < (best.resetAtMs ?? Infinity))
    ) {
      best = limit;
    }
  }
  if (!best || best.remaining === null) return null;
  return {
    label: best.label,
    remaining: Math.max(0, Math.min(1, best.remaining / 100)),
    resetAtMs: best.resetAtMs,
  };
}

const unitFormatters = new Map<string, Intl.NumberFormat>();

const getUnitFormatter = (unit: 'day' | 'hour' | 'minute', locale?: string) => {
  const key = `${locale ?? ''}:${unit}`;
  const cached = unitFormatters.get(key);
  if (cached) return cached;
  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' });
  } catch {
    formatter = new Intl.NumberFormat(undefined, { style: 'unit', unit, unitDisplay: 'narrow' });
  }
  unitFormatters.set(key, formatter);
  return formatter;
};

/**
 * Compact, localized duration for dense cells: "3d", "3h", "42m" (truncated, never below 1m).
 * Negative or missing durations return null.
 */
export function formatCompactDuration(ms: number | null, locale?: string): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms >= DAY_MS) return getUnitFormatter('day', locale).format(Math.floor(ms / DAY_MS));
  if (ms >= HOUR_MS) return getUnitFormatter('hour', locale).format(Math.floor(ms / HOUR_MS));
  return getUnitFormatter('minute', locale).format(Math.max(1, Math.floor(ms / MINUTE_MS)));
}

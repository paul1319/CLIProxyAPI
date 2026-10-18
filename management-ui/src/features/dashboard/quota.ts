/**
 * Read-only quota digest for the overview.
 *
 * The overview never fetches quota itself: it only reads whatever the Quota page (or a
 * credential card) has already put into `useQuotaStore`. Every provider shape is reduced
 * to the same reading — remaining fraction plus reset instant — so the provider table can
 * show "lowest remaining" and the pool panel "next reset".
 */

import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  PluginQuotaState,
  XaiQuotaState,
} from '@/types';
import { getQuotaCacheFileName } from '@/utils/quota/identity';

/** One rate-limit window: remaining capacity 0–1 and when it resets. */
export interface QuotaReading {
  remaining: number;
  resetAtMs: number | null;
}

export interface QuotaSources {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  devinQuota: Record<string, DevinQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  metaQuota: Record<string, MetaQuotaState>;
  pluginQuota: Record<string, PluginQuotaState>;
  xaiQuota: Record<string, XaiQuotaState>;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const fromUsedPercent = (used: number | null | undefined): number | null =>
  finite(used) ? clamp01(1 - used / 100) : null;

const instant = (value: number | null | undefined): number | null =>
  finite(value) && value > 0 ? value : null;

const isoInstant = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Only observed data counts; loading and failed reads say nothing about capacity. */
const hasObservation = (state: { status: string; hasData?: boolean }) =>
  state.status === 'success' || state.hasData === true;

const push = (out: QuotaReading[], remaining: number | null, resetAtMs: number | null) => {
  if (remaining !== null) out.push({ remaining, resetAtMs });
};

function windowedReadings(state: CodexQuotaState | ClaudeQuotaState): QuotaReading[] {
  const out: QuotaReading[] = [];
  for (const window of state.windows ?? []) {
    push(out, fromUsedPercent(window.usedPercent), instant(window.resetAtMs));
  }
  return out;
}

function groupedReadings(state: AntigravityQuotaState): QuotaReading[] {
  const out: QuotaReading[] = [];
  for (const group of state.groups ?? []) {
    for (const bucket of group.buckets ?? []) {
      push(
        out,
        finite(bucket.remainingFraction) ? clamp01(bucket.remainingFraction) : null,
        instant(bucket.resetAtMs) ?? isoInstant(bucket.resetTime)
      );
    }
  }
  return out;
}

function devinReadings(state: DevinQuotaState): QuotaReading[] {
  const out: QuotaReading[] = [];
  for (const window of state.windows ?? []) {
    push(
      out,
      finite(window.remainingPercent) ? clamp01(window.remainingPercent / 100) : null,
      instant(window.resetAtMs)
    );
  }
  return out;
}

function kimiReadings(state: KimiQuotaState): QuotaReading[] {
  const out: QuotaReading[] = [];
  for (const row of state.rows ?? []) {
    if (!(row.limit > 0)) continue;
    push(out, clamp01(1 - row.used / row.limit), instant(row.resetAtMs));
  }
  return out;
}

function metaReadings(state: MetaQuotaState): QuotaReading[] {
  const out: QuotaReading[] = [];
  for (const window of state.data?.windows ?? []) {
    push(
      out,
      fromUsedPercent(window.usedPercent),
      finite(window.resetAt) ? window.resetAt * 1000 : null
    );
  }
  return out;
}

function xaiReadings(state: XaiQuotaState): QuotaReading[] {
  const billing = state.billing;
  if (!billing || billing.mode === 'paid-health') return [];
  const out: QuotaReading[] = [];
  push(
    out,
    fromUsedPercent(billing.usagePercent ?? billing.usedPercent),
    instant(billing.resetAtMs) ?? isoInstant(billing.billingPeriodEnd)
  );
  return out;
}

function collect<T extends { status: string; hasData?: boolean }>(
  target: Map<string, QuotaReading[]>,
  cache: Record<string, T>,
  read: (state: T) => QuotaReading[]
) {
  for (const [key, state] of Object.entries(cache)) {
    if (!state || !hasObservation(state)) continue;
    const readings = read(state);
    if (readings.length === 0) continue;
    const fileName = getQuotaCacheFileName(key);
    target.set(fileName, [...(target.get(fileName) ?? []), ...readings]);
  }
}

/** Every observed quota window, keyed by credential file name. */
export function collectQuotaReadings(sources: QuotaSources): Map<string, QuotaReading[]> {
  const byFile = new Map<string, QuotaReading[]>();
  collect(byFile, sources.codexQuota, windowedReadings);
  collect(byFile, sources.claudeQuota, windowedReadings);
  collect(byFile, sources.antigravityQuota, groupedReadings);
  collect(byFile, sources.pluginQuota, groupedReadings);
  collect(byFile, sources.devinQuota, devinReadings);
  collect(byFile, sources.kimiQuota, kimiReadings);
  collect(byFile, sources.metaQuota, metaReadings);
  collect(byFile, sources.xaiQuota, xaiReadings);
  return byFile;
}

export interface QuotaFileRef {
  name: string;
  provider: string;
  disabled: boolean;
}

export interface QuotaOverview {
  /** True when at least one active credential has an observed quota window. */
  known: boolean;
  /** Lowest remaining window per provider (ties → earliest reset). */
  byProvider: Map<string, QuotaReading>;
  /** Earliest upcoming reset among windows below half capacity. */
  nextReset: { atMs: number; provider: string; remaining: number } | null;
}

/** Windows below this fraction are "constraining" and their reset is worth surfacing. */
export const CONSTRAINED_REMAINING = 0.5;

const isLower = (candidate: QuotaReading, current: QuotaReading | undefined) => {
  if (!current) return true;
  if (candidate.remaining !== current.remaining) return candidate.remaining < current.remaining;
  if (candidate.resetAtMs === null) return false;
  return current.resetAtMs === null || candidate.resetAtMs < current.resetAtMs;
};

export function summarizeQuota(
  readingsByFile: Map<string, QuotaReading[]>,
  files: QuotaFileRef[],
  nowMs: number
): QuotaOverview {
  const byProvider = new Map<string, QuotaReading>();
  let nextReset: QuotaOverview['nextReset'] = null;
  let known = false;

  for (const file of files) {
    if (file.disabled) continue;
    const readings = readingsByFile.get(file.name);
    if (!readings || readings.length === 0) continue;
    known = true;
    for (const reading of readings) {
      // A reset instant in the past means the reading is older than its window.
      const resetAtMs =
        reading.resetAtMs !== null && reading.resetAtMs > nowMs ? reading.resetAtMs : null;
      const normalized = { remaining: reading.remaining, resetAtMs };
      if (isLower(normalized, byProvider.get(file.provider))) {
        byProvider.set(file.provider, normalized);
      }
      if (
        resetAtMs !== null &&
        reading.remaining < CONSTRAINED_REMAINING &&
        (nextReset === null || resetAtMs < nextReset.atMs)
      ) {
        nextReset = { atMs: resetAtMs, provider: file.provider, remaining: reading.remaining };
      }
    }
  }

  return { known, byProvider, nextReset };
}

/**
 * Pool-level capacity: how many accounts can serve right now, which ones are
 * constrained, and when the next one comes back.
 *
 * Pure and React-free. Inputs are the per-account overviews the cards already
 * render plus the credential lamp, so the summary strip, the section headers
 * and the cards can never disagree about an account.
 */

import type { LampState } from '@/components/ui/StatusLamp';
import { LOW_REMAINING_FRACTION } from '@/components/ui/meterTone';
import type { AccountLimit, AccountOverview } from './accountCardModel';
import type { QuotaProviderType } from './providers/types';

/** Below this remaining percentage an account counts as running low (the shared meter rule). */
const LOW_REMAINING_PERCENT = LOW_REMAINING_FRACTION * 100;

export type AccountTone = LampState;

/**
 * One state per account, mutually exclusive. Precedence when several apply:
 * disabled > failing > cooling > exhausted > low > available, and unknown
 * while nothing has been observed.
 */
export type AccountState =
  'available' | 'low' | 'exhausted' | 'cooling' | 'failing' | 'disabled' | 'unknown';

export interface AccountSnapshotInput {
  key: string;
  name: string;
  type: QuotaProviderType;
  /** Overview built from visible data, or null while nothing has been observed. */
  overview: AccountOverview | null;
  /** Credential lamp from getCredentialLampState() — the same lamp every page shows. */
  lamp: LampState;
  /** The latest quota read failed (with or without retained data). */
  failing: boolean;
  /** Seconds left on an active routing cooldown, 0 when none. */
  cooldownSeconds: number;
  /** Manual resets the account can spend, null when unknown or unsupported. */
  resets: number | null;
}

export interface AccountSnapshot extends AccountSnapshotInput {
  state: AccountState;
  /** Strip segment tone: ok serving, warn constrained but recoverable, fault failing, idle off/unknown. */
  tone: AccountTone;
  hero: AccountLimit | null;
  /** When the constraining window resets — only while capacity is low or exhausted. */
  recoverAtMs: number | null;
}

const TONE_BY_STATE: Record<AccountState, AccountTone> = {
  available: 'ok',
  low: 'warn',
  exhausted: 'warn',
  cooling: 'warn',
  failing: 'fault',
  disabled: 'idle',
  unknown: 'idle',
};

function resolveState(
  input: AccountSnapshotInput,
  hero: AccountLimit | null,
  constrained: boolean
): AccountState {
  const { overview, lamp, failing, cooldownSeconds } = input;
  if (lamp === 'idle') return 'disabled';
  // Failing auth or an unreadable account; retained data keeps a stale read from turning red.
  if (lamp === 'fault' || (failing && !overview)) return 'failing';
  if (lamp === 'warn' || cooldownSeconds > 0) return 'cooling';
  if (!overview) return 'unknown';
  if (overview.available === false) return 'exhausted';
  if (constrained && hero) return 'low';
  return 'available';
}

export function snapshotAccount(input: AccountSnapshotInput): AccountSnapshot {
  const { overview } = input;
  const hero = overview?.limits.find((limit) => limit.id === overview.heroLimitId) ?? null;
  const remaining = hero?.remaining ?? null;
  const constrained =
    overview?.available === false || (remaining !== null && remaining < LOW_REMAINING_PERCENT);
  const state = resolveState(input, hero, constrained);
  return {
    ...input,
    state,
    tone: TONE_BY_STATE[state],
    hero,
    recoverAtMs: constrained ? (hero?.resetAtMs ?? null) : null,
  };
}

/** Whether routing can send traffic to the account right now. */
export const isServing = (account: AccountSnapshot): boolean =>
  account.state === 'available' || account.state === 'low';

export interface PoolRecovery {
  atMs: number;
  name: string;
  label: string;
  type: QuotaProviderType;
}

export interface PoolSummary {
  total: number;
  available: number;
  low: number;
  exhausted: number;
  cooling: number;
  failing: number;
  resets: number;
  /** Accounts in lamp order: ok → warn (low, exhausted, cooling) → fault → idle. */
  segments: AccountSnapshot[];
  /** Soonest capacity return among low or exhausted accounts. */
  next: PoolRecovery | null;
  /** True when at least one account has observed data. */
  observed: boolean;
}

const TONE_ORDER: Record<AccountTone, number> = { ok: 0, warn: 1, fault: 2, idle: 3 };
const STATE_ORDER: Record<AccountState, number> = {
  available: 0,
  low: 1,
  exhausted: 2,
  cooling: 3,
  failing: 4,
  disabled: 5,
  unknown: 6,
};

export function buildPoolSummary(accounts: readonly AccountSnapshot[], nowMs: number): PoolSummary {
  const byState: Record<AccountState, number> = {
    available: 0,
    low: 0,
    exhausted: 0,
    cooling: 0,
    failing: 0,
    disabled: 0,
    unknown: 0,
  };
  let resets = 0;
  let observed = false;
  let next: PoolRecovery | null = null;

  for (const account of accounts) {
    byState[account.state] += 1;
    if (account.overview) observed = true;
    if (account.resets !== null && account.resets > 0) resets += account.resets;
    if (account.recoverAtMs !== null && account.recoverAtMs > nowMs && account.hero) {
      if (next === null || account.recoverAtMs < next.atMs) {
        next = {
          atMs: account.recoverAtMs,
          name: account.name,
          label: account.hero.pool
            ? `${account.hero.pool} · ${account.hero.label}`
            : account.hero.label,
          type: account.type,
        };
      }
    }
  }

  const segments = accounts
    .map((account, index) => ({ account, index }))
    .sort(
      (a, b) =>
        TONE_ORDER[a.account.tone] - TONE_ORDER[b.account.tone] ||
        STATE_ORDER[a.account.state] - STATE_ORDER[b.account.state] ||
        a.index - b.index
    )
    .map(({ account }) => account);

  return {
    total: accounts.length,
    available: byState.available + byState.low,
    low: byState.low,
    exhausted: byState.exhausted,
    cooling: byState.cooling,
    failing: byState.failing,
    resets,
    segments,
    next,
    observed,
  };
}

export interface GroupSummary {
  count: number;
  available: number;
  /** Soonest reset among the accounts' focal windows. */
  nextResetMs: number | null;
}

export function buildGroupSummary(
  accounts: readonly AccountSnapshot[],
  nowMs: number
): GroupSummary {
  let available = 0;
  let nextResetMs: number | null = null;
  for (const account of accounts) {
    if (isServing(account)) available += 1;
    const atMs = account.hero?.resetAtMs ?? null;
    if (atMs !== null && atMs > nowMs && (nextResetMs === null || atMs < nextResetMs)) {
      nextResetMs = atMs;
    }
  }
  return { count: accounts.length, available, nextResetMs };
}

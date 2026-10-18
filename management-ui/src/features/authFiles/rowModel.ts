/**
 * Presentation model for one credential row (status line, refresh time).
 * React-free — consumed by tests/authFileRow.test.ts.
 */

import type { AuthFileItem } from '@/types';
import { parseTimestampMs } from '@/utils/timestamp';
import { getAuthFileStatusMessage, hasAuthFileStatusWarning } from './constants';
import { summarizeCooldowns } from './cooldowns';
import { getAuthFileHealth } from './logic';

export type AuthFileProblem =
  | { kind: 'status'; tone: 'fault'; message: string }
  | {
      kind: 'cooldown';
      tone: 'warn';
      /** Credential-wide (true) or only some models (false). */
      credentialWide: boolean;
      modelCount: number;
      remainingSeconds: number;
      httpStatus?: number;
      /** Raw server reason; render with `formatCooldownLine` / `cooldownReasonText`. */
      reason: string;
    };

/**
 * The single secondary line a row shows when something needs attention:
 * failing credentials show their upstream message, cooldowns show time left and why.
 * Disabled credentials never report problems (disabling is a deliberate state).
 */
export function describeAuthFileProblem(file: AuthFileItem, nowMs: number): AuthFileProblem | null {
  const health = getAuthFileHealth(file);
  if (health === 'disabled') return null;

  if (health === 'failing') {
    const message = hasAuthFileStatusWarning(file) ? getAuthFileStatusMessage(file) : '';
    return { kind: 'status', tone: 'fault', message };
  }

  const snapshot = file.cooldownSnapshot;
  if (!snapshot?.records?.length) return null;
  const summary = summarizeCooldowns(snapshot, nowMs);
  const active = summary.rows.filter((row) => row.remainingSeconds > 0);
  if (active.length === 0) return null;
  // Lead with the credential-wide record when present; otherwise the soonest model record.
  const lead =
    active.find((row) => row.record.scope === 'credential') ??
    active.reduce((soonest, row) =>
      row.remainingSeconds < soonest.remainingSeconds ? row : soonest
    );
  return {
    kind: 'cooldown',
    tone: 'warn',
    credentialWide: summary.credentialWide,
    modelCount: summary.modelCount,
    remainingSeconds: lead.remainingSeconds,
    httpStatus: lead.record.httpStatus,
    reason: lead.record.reason,
  };
}

/** Last token refresh instant reported by the backend, or null. */
export function readLastRefreshMs(file: AuthFileItem): number | null {
  const raw =
    file['last_refresh'] ??
    file.lastRefresh ??
    file['last_refreshed_at'] ??
    file['lastRefreshedAt'];
  if (raw === undefined || raw === null || raw === '') return null;
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  const ms = Number.isFinite(numeric)
    ? numeric < 1e12
      ? numeric * 1000
      : numeric
    : parseTimestampMs(raw);
  // Go zero time ("0001-01-01T00:00:00Z") and other pre-epoch values mean "never".
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

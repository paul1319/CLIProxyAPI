import type { TFunction } from 'i18next';
import type { AuthFileCooldown, AuthFileCooldownSnapshot } from '@/types/authFile';
import { formatCompactDuration } from './quotaSummary';

const REASON_KEYS: Record<string, string> = {
  quota: 'auth_files.cooldown_reason_quota',
  credential_quota: 'auth_files.cooldown_reason_credential_quota',
  cloudflare_challenge: 'auth_files.cooldown_reason_cloudflare_challenge',
  invalid_grant: 'auth_files.cooldown_reason_invalid_grant',
  unauthorized: 'auth_files.cooldown_reason_unauthorized',
  payment_required: 'auth_files.cooldown_reason_payment_required',
  not_found: 'auth_files.cooldown_reason_not_found',
  model_not_supported: 'auth_files.cooldown_reason_model_not_supported',
  transient_error: 'auth_files.cooldown_reason_transient_error',
};

const UNKNOWN_REASON_KEY = 'auth_files.cooldown_reason_unknown';

export function cooldownReasonKey(reason: string): string {
  return Object.prototype.hasOwnProperty.call(REASON_KEYS, reason)
    ? REASON_KEYS[reason]
    : UNKNOWN_REASON_KEY;
}

/**
 * Display text for a server reason: known codes are translated, anything else is shown
 * as the server sent it. Never the generic "unknown reason" label; blank → null (omit).
 */
export function cooldownReasonText(t: TFunction, reason: string | null | undefined): string | null {
  const raw = typeof reason === 'string' ? reason.trim() : '';
  if (!raw) return null;
  const key = cooldownReasonKey(raw);
  return key === UNKNOWN_REASON_KEY ? raw : t(key);
}

export type CooldownLineInput = {
  /** The whole credential is benched, not just some models. */
  credentialWide: boolean;
  /** Models with an active cooldown. */
  modelCount: number;
  /** Seconds left on the most relevant timer; 0 once it has elapsed. */
  remainingSeconds: number;
  httpStatus?: number;
  /** Raw server reason of the most relevant record. */
  reason?: string | null;
};

/**
 * The one cooldown wording shared by the Credentials rows and the Overview
 * "Needs attention" list: "Cooling down 42m · 429 · Quota restriction".
 */
export function formatCooldownLine(
  t: TFunction,
  cooldown: CooldownLineInput,
  locale?: string
): string {
  const time =
    cooldown.remainingSeconds > 0
      ? formatCompactDuration(cooldown.remainingSeconds * 1000, locale)
      : null;
  const scope = time
    ? cooldown.credentialWide
      ? t('credentials.problem_cooling', { time })
      : t('credentials.problem_models_cooling', { count: cooldown.modelCount, time })
    : cooldown.credentialWide
      ? t('dashboard.attention_cooldown')
      : t('auth_files.cooldown_models', { count: cooldown.modelCount });
  return [
    scope,
    time ? null : t('auth_files.cooldown_timer_elapsed'),
    cooldown.httpStatus !== undefined ? String(cooldown.httpStatus) : null,
    cooldownReasonText(t, cooldown.reason),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function cooldownRemainingSeconds(
  record: AuthFileCooldown,
  receivedAtMs: number,
  nowMs: number
): number {
  // remaining_seconds is measured by the server. Never subtract a local wall clock
  // from retry_at, or infer a deadline from backoff_level. Clamp pre-receipt ticks.
  const elapsedMs = Math.max(0, nowMs - receivedAtMs);
  return Math.max(0, Math.ceil(record.remainingSeconds - elapsedMs / 1000));
}

export function summarizeCooldowns(snapshot: AuthFileCooldownSnapshot, nowMs: number) {
  const rows = (snapshot.records ?? []).map((record) => ({
    record,
    remainingSeconds: cooldownRemainingSeconds(record, snapshot.receivedAtMs, nowMs),
  }));
  const active = rows.filter((row) => row.remainingSeconds > 0);
  return {
    rows,
    modelCount: active.filter((row) => row.record.scope === 'model').length,
    credentialWide: active.some((row) => row.record.scope === 'credential'),
    earliestSeconds: active.length ? Math.min(...active.map((row) => row.remainingSeconds)) : 0,
  };
}

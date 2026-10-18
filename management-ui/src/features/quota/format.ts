/**
 * Compact quota labels: countdowns, reset clocks and friendly upstream errors.
 *
 * Pure and clock-free — `nowMs` is always passed in — so the card, the pool
 * summary and the tests format instants the same way.
 */

import type { TFunction } from 'i18next';
import { DAY_MS, MINUTE_MS } from '@/utils/time/durations';

/**
 * "2h 14m", "3d 9h", "42m", "<1m". Truncates so a countdown never promises
 * extra time. Ten days or more — or any day count when `coarse` — drop the hours.
 */
export function formatCompactDuration(
  t: TFunction,
  deltaMs: number,
  options: { coarse?: boolean } = {}
): string {
  if (!Number.isFinite(deltaMs) || deltaMs < MINUTE_MS) {
    return t('antigravity_quota.duration_less_than_minute');
  }
  const totalMinutes = Math.floor(deltaMs / MINUTE_MS);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0 && (options.coarse || days >= 10)) return t('quota_management.age_days', { days });
  if (days > 0) return t('antigravity_quota.duration_day_hour', { days, hours });
  if (hours > 0) return t('antigravity_quota.duration_hour_minute', { hours, minutes });
  return t('antigravity_quota.duration_minute', { minutes });
}

/** Freshness age: "now" below a minute, otherwise the largest whole unit ("3m", "2h", "4d"). */
export function formatAge(t: TFunction, ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < MINUTE_MS) return t('quota_management.fresh_now');
  const minutes = Math.floor(ageMs / MINUTE_MS);
  if (minutes < 60) return t('antigravity_quota.duration_minute', { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('quota_management.age_hours', { hours });
  return t('quota_management.age_days', { days: Math.floor(ageMs / DAY_MS) });
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Wall-clock time of a reset, as short as stays unambiguous: "14:14" today,
 * "Wed 15:35" within the week, "Oct 21" beyond. 24-hour like every other
 * quota timestamp in the console.
 */
export function formatResetClock(atMs: number, nowMs: number, locale?: string): string {
  const at = new Date(atMs);
  const now = new Date(nowMs);
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try {
    if (sameDay(at, now)) return at.toLocaleTimeString(locale, time);
    if (Math.abs(atMs - nowMs) < 6 * DAY_MS) {
      return at.toLocaleString(locale, { weekday: 'short', ...time });
    }
    return at.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  } catch {
    return at.toLocaleString();
  }
}

/** Full timestamp for title tooltips. */
export function formatFullInstant(atMs: number, locale?: string): string {
  try {
    return new Date(atMs).toLocaleString(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23',
    });
  } catch {
    return new Date(atMs).toLocaleString();
  }
}

export type QuotaErrorKind = 'auth' | 'denied' | 'unsupported' | 'rate' | 'upstream' | 'generic';

/** Map an upstream status to an operator-facing category. */
export function classifyQuotaError(status: number | undefined): QuotaErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'denied';
  if (status === 404) return 'unsupported';
  if (status === 429) return 'rate';
  if (typeof status === 'number' && status >= 500) return 'upstream';
  return 'generic';
}

/** "Sign-in expired (401)" — the status stays visible for anyone grepping logs. */
export function describeQuotaError(t: TFunction, status: number | undefined): string {
  const label = t(`quota_management.error_${classifyQuotaError(status)}`);
  return typeof status === 'number' && status > 0 ? `${label} (${status})` : label;
}

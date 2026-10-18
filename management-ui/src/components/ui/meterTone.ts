export type MeterTone = 'neutral' | 'ok' | 'warn' | 'fault' | 'idle';

/** Remaining fraction below which capacity is flagged as low. */
export const LOW_REMAINING_FRACTION = 0.25;

/**
 * The single capacity-meter rule used across the console (Overview, Credentials, Quota, sheets):
 * healthy capacity stays neutral, low (<25%) is warn, exhausted (0) is fault, unknown is idle.
 * Color only flags what needs attention.
 */
export function toneForRemaining(remaining: number | null | undefined): MeterTone {
  if (remaining === null || remaining === undefined || Number.isNaN(remaining)) return 'idle';
  if (remaining <= 0) return 'fault';
  if (remaining < LOW_REMAINING_FRACTION) return 'warn';
  return 'neutral';
}

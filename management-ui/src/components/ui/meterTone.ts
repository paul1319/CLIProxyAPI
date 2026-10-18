export type MeterTone = 'neutral' | 'ok' | 'warn' | 'fault' | 'idle';

/** Remaining fraction below which capacity is flagged as low (red). */
export const LOW_REMAINING_FRACTION = 0.25;

/** Remaining fraction below which capacity is flagged as half-spent (yellow). */
export const HALF_REMAINING_FRACTION = 0.6;

/**
 * The single capacity-meter rule used across the console (Overview, Credentials, Quota, sheets):
 * plenty left (≥60%) is ok, half-spent (25–60%) is warn, low or exhausted (<25%) is fault,
 * unknown is idle.
 */
export function toneForRemaining(remaining: number | null | undefined): MeterTone {
  if (remaining === null || remaining === undefined || Number.isNaN(remaining)) return 'idle';
  if (remaining < LOW_REMAINING_FRACTION) return 'fault';
  if (remaining < HALF_REMAINING_FRACTION) return 'warn';
  return 'ok';
}

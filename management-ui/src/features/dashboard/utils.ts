import type { AuthFileItem } from '@/types/authFile';
import { TRAFFIC_BUCKET_MINUTES } from './types';

/** Provider id of a credential file; `unknown` when the backend left it blank. */
export function providerIdOfAuthFile(file: AuthFileItem): string {
  const candidate = String(file.type ?? file.provider ?? '')
    .trim()
    .toLowerCase();
  return candidate && candidate !== 'empty' ? candidate : 'unknown';
}

/** Provider display names. These are proper nouns, so they stay out of i18n. */
const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  'gemini-interactions': 'Interactions API',
  aistudio: 'AI Studio',
  codex: 'Codex',
  claude: 'Claude',
  devin: 'Devin',
  meta: 'Muse (Meta)',
  xai: 'xAI',
  vertex: 'Vertex AI',
  openai: 'OpenAI Compatible',
  'openai-compatibility': 'OpenAI Compatible',
  qwen: 'Qwen',
  kimi: 'Kimi',
  iflow: 'iFlow',
  antigravity: 'Antigravity',
};

/**
 * Resolve a provider display name. Unknown ids fall back to a capitalised id;
 * `unknown` is localised by the caller.
 */
export function providerLabel(id: string, unknownLabel: string): string {
  if (id === 'unknown' || !id) return unknownLabel;
  return PROVIDER_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export interface WindowParts {
  hours: number;
  minutes: number;
}

/** Split a window length in minutes into hours/minutes for i18n interpolation. */
export function splitWindowMinutes(totalMinutes: number): WindowParts {
  const safe = Math.max(0, Math.round(totalMinutes));
  return { hours: Math.floor(safe / 60), minutes: safe % 60 };
}

/** Bucket count → minutes covered. */
export function bucketsToMinutes(bucketCount: number): number {
  return bucketCount * TRAFFIC_BUCKET_MINUTES;
}

export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
}

/**
 * Split a positive duration into whole days/hours/minutes, truncating like a countdown
 * ("2h 14m" holds until 2h 13m). Negative input clamps to zero.
 */
export function splitDuration(ms: number): DurationParts {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  };
}

export type MeterTone = 'good' | 'warning' | 'critical' | 'idle';

/** Success rate → severity. The number is always shown; color is a secondary channel. */
export function toneForSuccessRate(rate: number | null): MeterTone {
  if (rate === null) return 'idle';
  if (rate >= 95) return 'good';
  if (rate >= 80) return 'warning';
  return 'critical';
}

/** Step ladder, finer than 1/2/5 so a peak of 112 is not stretched to 200. */
const STEP_LADDER = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;

/** Round a value up onto a readable step (ladder × 10^n). */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = STEP_LADDER.find((candidate) => normalized <= candidate) ?? 10;
  return step * magnitude;
}

/**
 * Axis maximum: round the tick spacing first, then multiply by the interval count.
 * Every gridline lands on a whole number and the top stays close to the peak.
 */
export function axisMax(peak: number, intervals: number): number {
  if (peak <= 0 || intervals <= 0) return Math.max(1, intervals);
  const step = Math.max(1, Math.ceil(niceCeil(peak / intervals)));
  return step * intervals;
}

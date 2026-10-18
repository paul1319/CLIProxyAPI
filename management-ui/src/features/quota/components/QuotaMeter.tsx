/**
 * Remaining-capacity bar for the provider bodies in the credential sheet.
 *
 * The host supplies the track geometry (`quotaBar` / `quotaBarFill`); the fill
 * color follows the console-wide meter rule (`toneForRemaining`): healthy
 * capacity stays neutral, low is warn, exhausted is fault. `percent === null`
 * renders an empty track — unknown is never colored. The fill keeps an inline
 * width so the rendered markup states the remaining direction.
 */

import type { CSSProperties } from 'react';
import type { MeterTone } from '@/components/ui/meterTone';
import type { QuotaClassMap } from '../types';
import { percentToFraction, toneForPercent } from '../windowRows';

/** Same colors as the shared `<Meter>`. */
const FILL_COLOR: Record<MeterTone, string> = {
  neutral: 'var(--ink-3)',
  ok: 'var(--signal-ok)',
  warn: 'var(--signal-warn)',
  fault: 'var(--signal-fault)',
  idle: 'var(--signal-idle)',
};

export interface QuotaMeterProps {
  percent: number | null;
  classes: QuotaClassMap;
}

export function QuotaMeter({ percent, classes }: QuotaMeterProps) {
  const fraction = percentToFraction(percent);
  const tone = toneForPercent(percent);
  const style: CSSProperties = {
    width: `${Math.round((fraction ?? 0) * 10000) / 100}%`,
    background: FILL_COLOR[tone],
  };

  return (
    <div className={classes.quotaBar}>
      <div className={classes.quotaBarFill} data-tone={tone} style={style} />
    </div>
  );
}

import type { ReactNode } from 'react';
import { toneForRemaining, type MeterTone } from './meterTone';
import styles from './Meter.module.scss';

interface MeterProps {
  /** Fill fraction 0–1. `null` renders an empty, idle track. */
  value: number | null;
  tone?: MeterTone;
  label?: ReactNode;
  /** Right side of the label row, e.g. "62% left". */
  valueLabel?: ReactNode;
  /** Small line under the track, e.g. "resets in 2h 14m". */
  caption?: ReactNode;
  /** Accessible description of the value. */
  ariaLabel?: string;
  className?: string;
}

export function Meter({
  value,
  tone,
  label,
  valueLabel,
  caption,
  ariaLabel,
  className,
}: MeterProps) {
  const clamped = value === null ? null : Math.min(1, Math.max(0, value));
  const resolvedTone = tone ?? toneForRemaining(clamped);
  return (
    <div className={className ? `${styles.meter} ${className}` : styles.meter}>
      {label || valueLabel ? (
        <div className={styles.labelRow}>
          <span className={styles.label}>{label}</span>
          {valueLabel ? <span className={styles.value}>{valueLabel}</span> : null}
        </div>
      ) : null}
      <div
        className={resolvedTone === 'fault' ? `${styles.track} ${styles.trackFault}` : styles.track}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped === null ? undefined : Math.round(clamped * 100)}
        aria-label={ariaLabel}
      >
        {clamped !== null ? (
          <div
            className={`${styles.fill} ${styles[resolvedTone]}`}
            style={{ transform: `scaleX(${clamped})` }}
          />
        ) : null}
      </div>
      {caption ? <div className={styles.caption}>{caption}</div> : null}
    </div>
  );
}

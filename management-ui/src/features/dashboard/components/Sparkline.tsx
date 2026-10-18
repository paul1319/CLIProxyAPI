import { useMemo } from 'react';
import styles from './Sparkline.module.scss';

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 20;
/** Keeps the peak stroke from being clipped at the top edge. */
const TOP_PADDING = 2;

interface SparklineProps {
  points: number[];
  ariaLabel: string;
  className?: string;
}

/**
 * Tiny single-series trend line. Straight segments on purpose: smoothing would invent
 * values between 10-minute buckets. The number next to it carries the value.
 */
export function Sparkline({ points, ariaLabel, className }: SparklineProps) {
  const path = useMemo(() => {
    const values = points.filter((value) => Number.isFinite(value));
    if (values.length === 0) return null;
    const max = Math.max(...values);
    const stepX = values.length > 1 ? VIEW_WIDTH / (values.length - 1) : 0;
    const usable = VIEW_HEIGHT - TOP_PADDING - 1;
    const coords = values.map((value, index) => {
      const x = values.length > 1 ? index * stepX : VIEW_WIDTH / 2;
      const y = VIEW_HEIGHT - 1 - (max > 0 ? value / max : 0) * usable;
      return `${x.toFixed(2)} ${y.toFixed(2)}`;
    });
    return { d: `M${coords.join(' L')}`, flat: max <= 0 };
  }, [points]);

  const classes = [styles.sparkline, path?.flat ? styles.flat : '', className]
    .filter(Boolean)
    .join(' ');

  if (!path) {
    return <span className={classes} aria-hidden="true" />;
  }

  return (
    <svg
      className={classes}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <path d={path.d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

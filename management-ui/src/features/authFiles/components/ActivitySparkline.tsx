import type { StatusBarData } from '@/utils/recentRequests';
import styles from './ActivitySparkline.module.scss';

export type ActivitySparklineProps = {
  data: StatusBarData;
  /** Shared scale (largest bucket in the pool) so rows compare honestly. */
  max: number;
  /** Bar width in px; the gap is fixed at 1px. */
  barWidth?: number;
  height?: number;
  /** Stretch to the container width (detail view) instead of a fixed pixel width. */
  fluid?: boolean;
};

/**
 * Twenty 10-minute request buckets. Traffic is neutral ink; only the failed share of a
 * bucket is drawn in the fault signal. Empty buckets keep a hairline baseline.
 */
export function ActivitySparkline({
  data,
  max,
  barWidth = 3,
  height = 16,
  fluid = false,
}: ActivitySparklineProps) {
  const buckets = data.blockDetails;
  const gap = 1;
  const width = buckets.length * (barWidth + gap) - gap;
  const scale = max > 0 ? max : 1;
  return (
    <svg
      className={styles.spark}
      width={fluid ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? 'none' : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {buckets.map((bucket, index) => {
        const x = index * (barWidth + gap);
        const total = bucket.success + bucket.failure;
        if (total === 0) {
          return (
            <rect
              key={index}
              className={styles.idle}
              x={x}
              y={height - 1}
              width={barWidth}
              height={1}
            />
          );
        }
        const barHeight = Math.max(2, Math.round((total / scale) * height));
        const failHeight =
          bucket.failure > 0 ? Math.max(1, Math.round((bucket.failure / total) * barHeight)) : 0;
        return (
          <g key={index}>
            <rect
              className={styles.ok}
              x={x}
              y={height - barHeight}
              width={barWidth}
              height={barHeight - failHeight}
            />
            {failHeight > 0 && (
              <rect
                className={styles.fail}
                x={x}
                y={height - failHeight}
                width={barWidth}
                height={failHeight}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

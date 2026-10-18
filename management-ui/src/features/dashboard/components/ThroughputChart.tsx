import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPercent } from '@/utils/format';
import { TRAFFIC_BUCKET_MINUTES, type TrafficWindow } from '../types';
import { axisMax } from '../utils';
import panelStyles from '../dashboard.module.scss';
import styles from './ThroughputChart.module.scss';

/** Gridlines including zero, i.e. TICK_COUNT - 1 intervals. */
const TICK_COUNT = 3;

/**
 * Bucket time label. The backend sends server-local strings ("15:04-15:14"); prefer them
 * over deriving times from the browser clock so time zones cannot disagree.
 */
function bucketRangeLabel(time: string | undefined, index: number, count: number): string {
  if (time) return time;
  const minutesAgo = (count - index) * TRAFFIC_BUCKET_MINUTES;
  return `-${minutesAgo}m`;
}

function bucketStartLabel(time: string | undefined, index: number, count: number): string {
  if (!time) return bucketRangeLabel(time, index, count);
  const [start] = time.split('-');
  return start?.trim() || time;
}

interface ThroughputChartProps {
  traffic: TrafficWindow;
}

function ThroughputChart({ traffic }: ThroughputChartProps) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const { buckets, totalSuccess, totalFailure, total, peakTotal } = traffic;
  const scaleMax = useMemo(() => axisMax(peakTotal, TICK_COUNT - 1), [peakTotal]);

  const ticks = useMemo(
    () =>
      Array.from({ length: TICK_COUNT }, (_, index) => {
        const ratio = 1 - index / (TICK_COUNT - 1);
        return { ratio, value: Math.round(scaleMax * ratio) };
      }),
    [scaleMax]
  );

  const xAxisTicks = useMemo(() => {
    if (buckets.length === 0) return [];
    const positions = [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1];
    return Array.from(new Set(positions)).map((index) => ({
      index,
      label: bucketStartLabel(buckets[index]?.time, index, buckets.length),
    }));
  }, [buckets]);

  if (buckets.length === 0) {
    return (
      <div className={styles.placeholder}>
        <p className={styles.placeholderTitle}>{t('dashboard.traffic_unavailable')}</p>
        <p className={styles.placeholderHint}>{t('dashboard.traffic_unavailable_hint')}</p>
      </div>
    );
  }

  const summary = t('dashboard.traffic_chart_summary', {
    total,
    success: totalSuccess,
    failed: totalFailure,
    minutes: traffic.windowMinutes,
  });

  const activeBucket = activeIndex === null ? null : buckets[activeIndex];
  const activeTotal = activeBucket ? activeBucket.success + activeBucket.failed : 0;
  const tooltipShift =
    activeIndex === null
      ? 'translateX(-50%)'
      : activeIndex < buckets.length * 0.2
        ? 'translateX(-10%)'
        : activeIndex > buckets.length * 0.8
          ? 'translateX(-90%)'
          : 'translateX(-50%)';

  return (
    <figure className={styles.chart}>
      <div className={styles.plot}>
        <div className={styles.yAxis} aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick.ratio}
              className={styles.yTick}
              style={{ top: `${(1 - tick.ratio) * 100}%` }}
            >
              {tick.value.toLocaleString()}
            </span>
          ))}
        </div>

        <div className={styles.canvas}>
          <div className={styles.gridlines} aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick.ratio}
                className={styles.gridline}
                style={{ top: `${(1 - tick.ratio) * 100}%` }}
              />
            ))}
          </div>

          <div
            className={styles.columns}
            role="img"
            aria-label={summary}
            onPointerLeave={() => setActiveIndex(null)}
          >
            {buckets.map((bucket, index) => {
              const bucketTotal = bucket.success + bucket.failed;
              return (
                <div
                  key={bucket.time ?? index}
                  className={`${styles.column} ${activeIndex === index ? styles.columnActive : ''}`}
                  onPointerEnter={() => setActiveIndex(index)}
                  onPointerDown={() => setActiveIndex(index)}
                >
                  <div className={styles.stack}>
                    {bucket.failed > 0 && (
                      <span
                        className={`${styles.segment} ${styles.segmentFailure}`}
                        style={{ height: `${(bucket.failed / scaleMax) * 100}%` }}
                      />
                    )}
                    {bucket.success > 0 && (
                      <span
                        className={`${styles.segment} ${styles.segmentSuccess}`}
                        style={{ height: `${(bucket.success / scaleMax) * 100}%` }}
                      />
                    )}
                    {bucketTotal === 0 && <span className={styles.idleTick} />}
                  </div>
                </div>
              );
            })}
          </div>

          {total === 0 && <p className={styles.noRequests}>{t('status_bar.no_requests')}</p>}

          {activeBucket && activeIndex !== null && (
            <div
              className={styles.tooltip}
              style={{
                left: `${((activeIndex + 0.5) / buckets.length) * 100}%`,
                transform: tooltipShift,
              }}
              aria-hidden="true"
            >
              <span className={styles.tooltipTime}>
                {bucketRangeLabel(activeBucket.time, activeIndex, buckets.length)}
              </span>
              <span className={styles.tooltipRow}>
                <span className={`${styles.swatch} ${styles.swatchSuccess}`} />
                {t('stats.success')}
                <b>{activeBucket.success.toLocaleString()}</b>
              </span>
              <span className={styles.tooltipRow}>
                <span className={`${styles.swatch} ${styles.swatchFailure}`} />
                {t('dashboard.figure_failures')}
                <b>{activeBucket.failed.toLocaleString()}</b>
              </span>
              <span className={styles.tooltipRate}>
                {activeTotal > 0
                  ? formatPercent((activeBucket.success / activeTotal) * 100)
                  : t('status_bar.no_requests')}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.xAxis} aria-hidden="true">
        {xAxisTicks.map((tick) => (
          <span
            key={tick.index}
            className={styles.xTick}
            style={{ left: `${((tick.index + 0.5) / buckets.length) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>

      {/* Screen-reader equivalent of the hover tooltip. */}
      <table className={styles.srOnly}>
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">{t('dashboard.traffic_table_window')}</th>
            <th scope="col">{t('stats.success')}</th>
            <th scope="col">{t('dashboard.figure_failures')}</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket, index) => (
            <tr key={bucket.time ?? index}>
              <th scope="row">{bucketRangeLabel(bucket.time, index, buckets.length)}</th>
              <td>{bucket.success}</td>
              <td>{bucket.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

interface ThroughputPanelProps {
  traffic: TrafficWindow;
  windowLabel: string;
}

/** Freshness lives in the page header next to Refresh, as on Credentials. */
export function ThroughputPanel({ traffic, windowLabel }: ThroughputPanelProps) {
  const { t } = useTranslation();
  const hasBuckets = traffic.buckets.length > 0;

  return (
    <section
      className={`${panelStyles.panel} ${styles.panel}`}
      aria-labelledby="overview-throughput-title"
    >
      <header className={panelStyles.panelHeader}>
        <div className={panelStyles.panelHeading}>
          <h2 id="overview-throughput-title" className={panelStyles.panelTitle}>
            {t('dashboard.throughput_title')}
          </h2>
          {hasBuckets && (
            <p className={panelStyles.panelMeta}>
              {t('dashboard.throughput_meta', { window: windowLabel })}
            </p>
          )}
        </div>
        {hasBuckets && (
          <ul className={styles.legend}>
            <li className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.swatchSuccess}`} aria-hidden="true" />
              {t('stats.success')}
              <b>{traffic.totalSuccess.toLocaleString()}</b>
            </li>
            <li className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.swatchFailure}`} aria-hidden="true" />
              {t('dashboard.figure_failures')}
              <b>{traffic.totalFailure.toLocaleString()}</b>
            </li>
          </ul>
        )}
      </header>
      <ThroughputChart traffic={traffic} />
    </section>
  );
}

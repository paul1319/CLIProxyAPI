/** Window rows of a quota card: one line per limit, gating windows first. */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Meter } from '@/components/ui/Meter';
import type { AccountLimit } from '../accountCardModel';
import { formatCompactDuration, formatFullInstant } from '../format';
import {
  VISIBLE_WINDOW_ROWS,
  orderWindowRows,
  percentToFraction,
  toneForPercent,
} from '../windowRows';
import styles from './QuotaCard.module.scss';

interface QuotaWindowsProps {
  limits: readonly AccountLimit[];
  heroId: string | null;
  now: number;
}

export function QuotaWindows({ limits, heroId, now }: QuotaWindowsProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const ordered = orderWindowRows(limits);
  const visible = expanded ? ordered : ordered.slice(0, VISIBLE_WINDOW_ROWS);
  const hiddenCount = ordered.length - visible.length;
  if (ordered.length === 0) return null;

  return (
    <>
      <ul className={styles.rows} aria-label={t('account_quota.limits')}>
        {visible.map((limit, index) => {
          const tone = toneForPercent(limit.remaining);
          const percent = limit.remaining === null ? null : Math.round(limit.remaining);
          const showPool = Boolean(limit.pool) && limit.pool !== visible[index - 1]?.pool;
          const resetTitle =
            limit.resetAtMs !== null
              ? t('quota_management.window_reset_title', {
                  time: formatFullInstant(limit.resetAtMs, i18n.resolvedLanguage),
                })
              : undefined;
          const countdown =
            limit.resetAtMs !== null
              ? formatCompactDuration(t, limit.resetAtMs - now)
              : (limit.resetLabel ?? '');
          return (
            <li key={limit.id} className={styles.rowItem}>
              {showPool && <span className={styles.pool}>{limit.pool}</span>}
              <div
                className={styles.row}
                data-hero={limit.id === heroId ? 'true' : undefined}
                data-scope={limit.scope}
              >
                <span
                  className={styles.rowLabel}
                  title={limit.amount ? `${limit.label} · ${limit.amount}` : limit.label}
                >
                  {limit.label}
                </span>
                <Meter
                  className={styles.bar}
                  value={percentToFraction(limit.remaining)}
                  tone={tone}
                  ariaLabel={limit.label}
                />
                <span className={styles.rowValue} data-tone={tone}>
                  {percent === null ? '—' : `${percent}%`}
                </span>
                <span className={styles.rowReset} title={resetTitle}>
                  {countdown}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {(hiddenCount > 0 || expanded) && ordered.length > VISIBLE_WINDOW_ROWS && (
        <button
          type="button"
          className={styles.moreToggle}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? t('quota_management.window_less')
            : t('quota_management.window_more', { count: hiddenCount })}
        </button>
      )}
    </>
  );
}

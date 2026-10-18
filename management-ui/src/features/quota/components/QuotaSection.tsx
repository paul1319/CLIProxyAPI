/** Provider sections: one header line over each credential table, all on one page grid. */

import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { GroupSummary } from '../poolSummary';
import type { QuotaProviderType } from '../providers/types';
import { formatCompactDuration } from '../format';
import { ProviderGlyph } from './ProviderGlyph';
import styles from './QuotaTable.module.scss';

interface QuotaSectionsProps {
  /** Cell slots shared by every section: window columns, then manual resets. */
  slots: number;
  children: ReactNode;
}

/** Every section subgrids into one grid, so each column lines up down the page. */
export function QuotaSections({ slots, children }: QuotaSectionsProps) {
  return (
    <div className={styles.sections}>
      <div className={styles.grid} style={{ '--quota-slots': slots } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

interface QuotaSectionProps {
  type: QuotaProviderType;
  summary: GroupSummary;
  now: number;
  children: ReactNode;
}

export function QuotaSection({ type, summary, now, children }: QuotaSectionProps) {
  const { t } = useTranslation();
  const headingId = `quota-group-${type}`;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.sectionHead}>
        <ProviderGlyph type={type} />
        <h2 id={headingId} className={styles.sectionTitle}>
          {getTypeLabel(t, type)}
        </h2>
        <span className={styles.sectionCount}>{summary.count}</span>
        <p className={styles.sectionMeta}>
          <span>{t('quota_management.meta_serving', { count: summary.available })}</span>
          {summary.nextResetMs !== null && (
            <span>
              {t('quota_management.group_next_reset', {
                duration: formatCompactDuration(t, summary.nextResetMs - now),
              })}
            </span>
          )}
        </p>
      </header>
      <div className={styles.frame}>
        <ul className={styles.table}>{children}</ul>
      </div>
    </section>
  );
}

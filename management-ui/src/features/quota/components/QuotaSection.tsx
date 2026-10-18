/** A provider section: one header line over the credential table. */

import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { GroupSummary } from '../poolSummary';
import type { QuotaProviderType } from '../providers/types';
import { formatCompactDuration } from '../format';
import { ProviderGlyph } from './ProviderGlyph';
import styles from './QuotaTable.module.scss';

interface QuotaSectionProps {
  type: QuotaProviderType;
  summary: GroupSummary;
  /** Cell columns shared by every section, so tables line up down the page. */
  slots: number;
  now: number;
  children: ReactNode;
}

export function QuotaSection({ type, summary, slots, now, children }: QuotaSectionProps) {
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
        <ul className={styles.table} style={{ '--quota-slots': slots } as CSSProperties}>
          {children}
        </ul>
      </div>
    </section>
  );
}

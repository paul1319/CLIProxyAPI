import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { Skeleton } from '@/components/ui/Skeleton';
import styles from './AuthFilesTable.module.scss';

export type AuthFilesTableProps = {
  compact: boolean;
  selectionMode: boolean;
  /** Header checkbox: every selectable row on this page is selected. */
  allSelected: boolean;
  selectableCount: number;
  onToggleAll: (checked: boolean) => void;
  children: ReactNode;
};

/** Column header + row list. Rows are list items; the header only labels columns visually. */
export function AuthFilesTable({
  compact,
  selectionMode,
  allSelected,
  selectableCount,
  onToggleAll,
  children,
}: AuthFilesTableProps) {
  const { t } = useTranslation();
  return (
    <div className={`${styles.table} ${compact ? styles.compact : ''}`}>
      <div className={styles.headRow}>
        <div
          className={`${styles.cell} ${styles.cellSelect}`}
          data-visible={selectionMode || undefined}
        >
          <SelectionCheckbox
            checked={allSelected}
            disabled={selectableCount === 0}
            onChange={onToggleAll}
            ariaLabel={t('credentials.select_page')}
            title={t('credentials.select_page')}
          />
        </div>
        <div className={`${styles.cell} ${styles.cellLamp}`} />
        <div className={`${styles.cell} ${styles.cellGlyph}`} />
        <div
          className={`${styles.cell} ${styles.cellAccount} ${styles.headLabel}`}
          aria-hidden="true"
        >
          {t('credentials.col_account')}
        </div>
        <div
          className={`${styles.cell} ${styles.cellQuota} ${styles.headLabel}`}
          aria-hidden="true"
        >
          {t('credentials.col_quota')}
        </div>
        <div
          className={`${styles.cell} ${styles.cellActivity} ${styles.headLabel}`}
          aria-hidden="true"
        >
          {t('credentials.col_activity')}
        </div>
        <div
          className={`${styles.cell} ${styles.cellRefreshed} ${styles.headLabel}`}
          aria-hidden="true"
        >
          {t('credentials.col_refreshed')}
        </div>
        <div
          className={`${styles.cell} ${styles.cellToggle} ${styles.headLabel}`}
          aria-hidden="true"
        >
          {t('credentials.col_enabled')}
        </div>
        <div className={`${styles.cell} ${styles.cellMenu}`} />
      </div>
      <ul className={styles.rows} aria-label={t('credentials.list_label')}>
        {children}
      </ul>
    </div>
  );
}

/** Placeholder rows with the real row geometry, so the first paint never jumps. */
export function AuthFilesSkeletonRows({ count, compact }: { count: number; compact: boolean }) {
  return (
    <div className={`${styles.table} ${compact ? styles.compact : ''}`} aria-hidden="true">
      <div className={styles.headRow}>
        <div className={`${styles.cell} ${styles.cellAccount}`}>
          <Skeleton width={72} height={10} rounded={3} />
        </div>
      </div>
      <ul className={styles.rows}>
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className={`${styles.row} ${styles.rowSkeleton}`}>
            <div className={`${styles.cell} ${styles.cellLamp}`}>
              <Skeleton width={8} height={8} rounded={4} />
            </div>
            <div className={`${styles.cell} ${styles.cellGlyph}`}>
              <Skeleton width={24} height={24} rounded={6} />
            </div>
            <div className={`${styles.cell} ${styles.cellAccount}`}>
              <Skeleton width={`${48 + ((index * 17) % 30)}%`} height={10} rounded={3} />
              {!compact && (
                <Skeleton width={`${30 + ((index * 11) % 20)}%`} height={8} rounded={3} />
              )}
            </div>
            <div className={`${styles.cell} ${styles.cellQuota}`}>
              <Skeleton width={120} height={8} rounded={3} />
            </div>
            <div className={`${styles.cell} ${styles.cellActivity}`}>
              <Skeleton width={96} height={10} rounded={3} />
            </div>
            <div className={`${styles.cell} ${styles.cellRefreshed}`}>
              <Skeleton width={56} height={8} rounded={3} />
            </div>
            <div className={`${styles.cell} ${styles.cellToggle}`}>
              <Skeleton width={28} height={16} rounded={8} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

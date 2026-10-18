import type { ReactNode } from 'react';
import styles from './PageHeader.module.scss';

interface PageHeaderProps {
  title: ReactNode;
  /** Short status line under the title, e.g. "5 credentials · 4 serving". */
  meta?: ReactNode;
  /** Right-aligned actions; keep to one primary button plus a few secondary/ghost ones. */
  actions?: ReactNode;
  /** Optional row rendered under the title row (tabs, segmented filters). */
  tabs?: ReactNode;
  className?: string;
}

export function PageHeader({ title, meta, actions, tabs, className }: PageHeaderProps) {
  return (
    <header className={className ? `${styles.header} ${className}` : styles.header}>
      <div className={styles.row}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{title}</h1>
          {meta ? <div className={styles.meta}>{meta}</div> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {tabs ? <div className={styles.tabs}>{tabs}</div> : null}
    </header>
  );
}

/** Separator for PageHeader meta items: renders "a · b · c". */
export function MetaDot() {
  return (
    <span className={styles.dot} aria-hidden="true">
      ·
    </span>
  );
}

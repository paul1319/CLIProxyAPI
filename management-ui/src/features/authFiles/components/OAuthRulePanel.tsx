import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { IconPencil, IconTrash2 } from '@/components/ui/icons';
import { useThemeStore } from '@/stores';
import { getTypeLabel, type OAuthConfigLoadError } from '@/features/authFiles/constants';
import { ProviderGlyph } from './ProviderGlyph';
import styles from './OAuthConfigPanels.module.scss';

export type OAuthRuleRow = {
  provider: string;
  count: number;
  /** Short mono preview of the first few rules. */
  preview: string[];
};

export type OAuthRulePanelProps = {
  title: string;
  description: string;
  actions: ReactNode;
  loadError: OAuthConfigLoadError;
  upgradeTitle: string;
  upgradeDescription: string;
  emptyText: string;
  rows: OAuthRuleRow[];
  countLabel: (count: number) => string;
  deleteLabel: string;
  disableControls: boolean;
  onRetry: () => void | Promise<void>;
  onEdit: (provider: string) => void;
  onDelete: (provider: string) => void;
  /** Replaces the row list (e.g. the alias diagram). */
  children?: ReactNode;
};

const PREVIEW_LIMIT = 3;

/** One per-provider rule table: provider · rule preview · count · Edit / Delete. */
export function OAuthRulePanel(props: OAuthRulePanelProps) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const {
    title,
    description,
    actions,
    loadError,
    upgradeTitle,
    upgradeDescription,
    emptyText,
    rows,
    countLabel,
    deleteLabel,
    disableControls,
    onRetry,
    onEdit,
    onDelete,
    children,
  } = props;

  let body: ReactNode;
  if (loadError === 'unsupported') {
    body = <EmptyState title={upgradeTitle} description={upgradeDescription} />;
  } else if (loadError === 'load') {
    body = (
      <div className={styles.inlineError} role="alert">
        <span>{t('credentials.rules_load_failed')}</span>
        <Button variant="secondary" size="sm" onClick={() => void onRetry()}>
          {t('credentials.retry')}
        </Button>
      </div>
    );
  } else if (loadError === 'loading') {
    body = (
      <ul className={styles.rows} aria-busy="true">
        {[0, 1].map((index) => (
          <li key={index} className={styles.row}>
            <Skeleton width={20} height={20} rounded={4} />
            <Skeleton width={`${30 + index * 12}%`} height={10} rounded={3} />
          </li>
        ))}
      </ul>
    );
  } else if (children) {
    body = children;
  } else if (rows.length === 0) {
    body = <p className={styles.empty}>{emptyText}</p>;
  } else {
    body = (
      <ul className={styles.rows}>
        {rows.map((row) => {
          const label = getTypeLabel(t, row.provider);
          const extra = row.preview.length - PREVIEW_LIMIT;
          return (
            <li key={row.provider} className={styles.row}>
              <ProviderGlyph provider={row.provider} resolvedTheme={resolvedTheme} size="sm" />
              <div className={styles.rowProvider}>
                <span className={styles.rowTitle}>{label}</span>
                {label.toLowerCase() !== row.provider.toLowerCase() && (
                  <span className={styles.rowKey}>{row.provider}</span>
                )}
              </div>
              <div className={styles.rowPreview}>
                {row.preview.slice(0, PREVIEW_LIMIT).map((item, index) => (
                  <code key={`${item}:${index}`} className={styles.chip}>
                    {item}
                  </code>
                ))}
                {extra > 0 && <span className={styles.more}>+{extra}</span>}
              </div>
              <span className={styles.rowCount}>{countLabel(row.count)}</span>
              <div className={styles.rowActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(row.provider)}
                  disabled={disableControls}
                >
                  <IconPencil size={14} />
                  {t('common.edit')}
                </Button>
                <button
                  type="button"
                  className={styles.deleteIcon}
                  onClick={() => onDelete(row.provider)}
                  disabled={disableControls}
                  title={`${deleteLabel} · ${label}`}
                  aria-label={`${deleteLabel} · ${label}`}
                >
                  <IconTrash2 size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <div className={styles.panelCopy}>
          <h2 className={styles.panelTitle}>{title}</h2>
          <p className={styles.panelDescription}>{description}</p>
        </div>
        <div className={styles.panelExtra}>{actions}</div>
      </header>
      <div className={styles.panelBody}>{body}</div>
    </section>
  );
}

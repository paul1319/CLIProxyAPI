import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { StatusLamp } from '@/components/ui/StatusLamp';
import { IconChevronUp } from '@/components/ui/icons';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import styles from './SaveBar.module.scss';

export type SaveBarChange = {
  fieldId: string;
  label: string;
  /** Short section name shown next to the label. */
  section: string;
};

export type SaveBarProps = {
  /** Visible while the page is current and has unsaved changes (same condition as the leave guard). */
  visible: boolean;
  /** Changed visual settings, in page order (popover jump list). */
  changes: SaveBarChange[];
  /** The YAML draft was edited directly; field-level changes are unknown. */
  sourceDirty: boolean;
  errorCount: number;
  /** Replaces the change summary (saving, recovery required, disconnected …). */
  statusText?: string | null;
  statusTone?: 'busy' | 'error' | 'muted';
  saving: boolean;
  saveDisabled: boolean;
  discardDisabled: boolean;
  shortcutLabel: string;
  onSave: () => void;
  onDiscard: () => void;
  onJumpToField?: (fieldId: string) => void;
  onGoToError?: () => void;
};

/**
 * Sticky save bar docked to the bottom of the content column, shown only with unsaved changes.
 * Left: what changed (with a jump list) and blocking errors; right: Discard and Review & save.
 * Its live height is published as --config-action-bar-height.
 */
export function SaveBar({
  visible,
  changes,
  sourceDirty,
  errorCount,
  statusText,
  statusTone = 'muted',
  saving,
  saveDisabled,
  discardDisabled,
  shortcutLabel,
  onSave,
  onDiscard,
  onJumpToField,
  onGoToError,
}: SaveBarProps) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const listId = useId();
  const canList = changes.length > 0 && !sourceDirty && !statusText;
  const isListOpen = listOpen && canList && visible;

  useActionBarHeightVar(barRef, '--config-action-bar-height', visible);

  useEffect(() => {
    if (!isListOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) setListOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setListOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isListOpen]);

  if (!visible) return null;

  const lampState = statusText
    ? statusTone === 'error'
      ? 'fault'
      : 'idle'
    : errorCount > 0
      ? 'fault'
      : 'warn';

  const summary = statusText ? (
    <span className={`${styles.summaryText} ${statusTone === 'error' ? styles.toneError : ''}`}>
      {statusText}
    </span>
  ) : sourceDirty ? (
    <span className={styles.summaryText}>{t('config_management.meta_dirty_source')}</span>
  ) : canList ? (
    <button
      type="button"
      className={styles.summaryButton}
      aria-expanded={isListOpen}
      aria-controls={isListOpen ? listId : undefined}
      onClick={() => setListOpen((open) => !open)}
    >
      <span className="tabular">
        {t('config_management.save_bar.unsaved', { count: changes.length })}
      </span>
      <IconChevronUp
        size={14}
        className={`${styles.summaryChevron} ${isListOpen ? styles.summaryChevronOpen : ''}`}
        aria-hidden="true"
      />
    </button>
  ) : (
    <span className={styles.summaryText}>{t('config_management.status_dirty')}</span>
  );

  return (
    <div className={styles.dock}>
      <div
        ref={barRef}
        className={styles.bar}
        role="region"
        aria-label={t('config_management.status_dirty')}
      >
        <div className={styles.left} aria-live="polite">
          <StatusLamp state={lampState} live={saving} />
          {summary}
          {errorCount > 0 && !statusText ? (
            <span className={styles.errors}>
              <span className={styles.separator} aria-hidden="true">
                ·
              </span>
              <span className={styles.errorText}>
                {t('config_management.save_bar.errors', { count: errorCount })}
              </span>
              {onGoToError ? (
                <button type="button" className={styles.linkButton} onClick={onGoToError}>
                  {t('config_management.save_bar.go_to')}
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={discardDisabled}>
            {t('config_management.save_bar.discard')}
          </Button>
          <Button size="sm" onClick={onSave} disabled={saveDisabled} loading={saving}>
            <span className={styles.saveLabel}>
              {t('config_management.save_bar.review')}
              <kbd className={styles.kbd}>{shortcutLabel}</kbd>
            </span>
          </Button>
        </div>

        {isListOpen ? (
          <div
            id={listId}
            className={styles.popover}
            role="group"
            aria-label={t('config_management.status_dirty')}
          >
            <div className={styles.popoverHeader}>{t('config_management.status_dirty')}</div>
            <ul className={styles.changeList}>
              {changes.map((change) => (
                <li key={change.fieldId}>
                  <button
                    type="button"
                    className={styles.changeItem}
                    onClick={() => {
                      setListOpen(false);
                      onJumpToField?.(change.fieldId);
                    }}
                  >
                    <span className={styles.changeLabel}>{change.label}</span>
                    <span className={styles.changeSection}>{change.section}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

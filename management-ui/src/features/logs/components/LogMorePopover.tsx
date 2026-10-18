import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconDownload,
  IconMaximize2,
  IconMinimize2,
  IconSlidersHorizontal,
  IconTrash2,
} from '@/components/ui/icons';
import { MANAGEMENT_API_PREFIX } from '@/utils/constants';
import { HTTP_METHODS, type HttpMethod } from '../model/logTypes';
import type { LogToolbarActions } from './LogToolbar';
import styles from './LogToolbar.module.scss';

type Setter = (value: boolean) => void;

export interface LogMorePopoverProps {
  methodFilters: HttpMethod[];
  methodCounts: Partial<Record<HttpMethod, number>>;
  onToggleMethod: (method: HttpMethod) => void;
  pathFilters: string[];
  pathOptions: Array<{ path: string; count: number }>;
  onTogglePath: (path: string) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  display: {
    hideManagement: boolean;
    setHideManagement: Setter;
    showIp: boolean;
    setShowIp: Setter;
    showSource: boolean;
    setShowSource: Setter;
    wrap: boolean;
    setWrap: Setter;
    raw: boolean;
    setRaw: Setter;
  };
  actions: LogToolbarActions;
}

/** Non-modal popover: secondary filters, display options and (on mobile) overflow actions. */
export function LogMorePopover({
  methodFilters,
  methodCounts,
  onToggleMethod,
  pathFilters,
  pathOptions,
  onTogglePath,
  hasFilters,
  onClearFilters,
  display,
  actions,
}: LogMorePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const hiddenFilterCount = methodFilters.length + pathFilters.length;

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Capture phase so Escape closes the popover before it can exit fullscreen.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const methods = HTTP_METHODS.filter(
    (method) => (methodCounts[method] ?? 0) > 0 || methodFilters.includes(method)
  );
  const runAndClose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className={styles.more} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.moreButton}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={t('logs.more_title')}
        onClick={() => setOpen((value) => !value)}
      >
        <IconSlidersHorizontal size={14} />
        <span className={styles.moreLabel}>{t('logs.more')}</span>
        {hiddenFilterCount > 0 ? (
          <span className={styles.moreCount}>{hiddenFilterCount}</span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className={styles.popover}
          role="dialog"
          aria-label={t('logs.more_title')}
          tabIndex={-1}
        >
          <section className={styles.popSection}>
            <div className={styles.popHeading}>
              <span className="overline">{t('logs.filter_method')}</span>
            </div>
            <div className={styles.chipList}>
              {methods.length === 0 ? (
                <span className={styles.popHint}>—</span>
              ) : (
                methods.map((method) => (
                  <button
                    key={method}
                    type="button"
                    className={styles.chip}
                    aria-pressed={methodFilters.includes(method)}
                    onClick={() => onToggleMethod(method)}
                  >
                    {method}
                    <span className={styles.chipCount}>{methodCounts[method] ?? 0}</span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className={styles.popSection}>
            <div className={styles.popHeading}>
              <span className="overline">{t('logs.filter_path')}</span>
            </div>
            <div className={styles.chipList}>
              {pathOptions.length === 0 ? (
                <span className={styles.popHint}>{t('logs.filter_path_empty')}</span>
              ) : (
                pathOptions.map(({ path, count }) => (
                  <button
                    key={path}
                    type="button"
                    className={`${styles.chip} ${styles.chipPath}`}
                    aria-pressed={pathFilters.includes(path)}
                    onClick={() => onTogglePath(path)}
                    title={path}
                  >
                    <span className={styles.chipText}>{path}</span>
                    <span className={styles.chipCount}>{count}</span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className={`${styles.popSection} ${styles.popToggles}`}>
            <div className={styles.popHeading}>
              <span className="overline">{t('logs.section_display')}</span>
            </div>
            <div className={styles.toggleRow}>
              <ToggleSwitch
                labelPosition="left"
                checked={display.hideManagement}
                onChange={display.setHideManagement}
                label={t('logs.hide_management_logs', { prefix: MANAGEMENT_API_PREFIX })}
              />
            </div>
            <div className={styles.toggleRow}>
              <ToggleSwitch
                labelPosition="left"
                checked={display.showIp}
                onChange={display.setShowIp}
                label={t('logs.show_ip')}
              />
            </div>
            <div className={styles.toggleRow}>
              <ToggleSwitch
                labelPosition="left"
                checked={display.showSource}
                onChange={display.setShowSource}
                label={t('logs.show_source')}
              />
            </div>
            <div className={styles.toggleRow}>
              <ToggleSwitch
                labelPosition="left"
                checked={display.wrap}
                onChange={display.setWrap}
                label={t('logs.wrap_lines')}
              />
            </div>
            <div className={styles.toggleRow}>
              <ToggleSwitch
                labelPosition="left"
                checked={display.raw}
                onChange={display.setRaw}
                label={<span title={t('logs.show_raw_logs_hint')}>{t('logs.show_raw_logs')}</span>}
              />
            </div>
          </section>

          <section className={`${styles.popSection} ${styles.popActions} ${styles.mobileOnly}`}>
            <button
              type="button"
              className={styles.popAction}
              onClick={runAndClose(actions.onDownload)}
              disabled={actions.downloadDisabled}
            >
              <IconDownload size={15} />
              {t('logs.download_cached')}
            </button>
            <button
              type="button"
              className={styles.popAction}
              onClick={runAndClose(actions.onToggleFullscreen)}
            >
              {actions.fullscreen ? <IconMinimize2 size={15} /> : <IconMaximize2 size={15} />}
              {actions.fullscreen ? t('logs.exit_fullscreen_button') : t('logs.fullscreen_button')}
            </button>
            <button
              type="button"
              className={`${styles.popAction} ${styles.popActionDanger}`}
              onClick={runAndClose(actions.onClear)}
              disabled={actions.clearDisabled}
            >
              <IconTrash2 size={15} />
              {t('logs.clear_button')}
            </button>
          </section>

          {hasFilters ? (
            <div className={styles.popFooter}>
              <button type="button" className={styles.textButton} onClick={onClearFilters}>
                {t('logs.clear_filters')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

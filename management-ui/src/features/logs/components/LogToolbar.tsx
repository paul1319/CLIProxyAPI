import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusLamp } from '@/components/ui/StatusLamp';
import {
  IconDownload,
  IconMaximize2,
  IconMinimize2,
  IconPause,
  IconRefreshCw,
  IconSearch,
  IconTrash2,
  IconX,
} from '@/components/ui/icons';
import { STATUS_GROUPS, type StatusGroup } from '../model/logTypes';
import { formatUpdatedClock, LEVEL_THRESHOLDS, type LevelThreshold } from '../model/logDisplay';
import { LogMorePopover, type LogMorePopoverProps } from './LogMorePopover';
import styles from './LogToolbar.module.scss';

export interface LogToolbarActions {
  onRefresh: () => void;
  refreshDisabled: boolean;
  refreshing: boolean;
  onDownload: () => void;
  downloadDisabled: boolean;
  onClear: () => void;
  clearDisabled: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

interface LogToolbarProps {
  live: {
    enabled: boolean;
    catchingUp: boolean;
    lastUpdated?: number;
    disabled: boolean;
    onToggle: () => void;
  };
  search: {
    value: string;
    onChange: (value: string) => void;
    /** Number of lines left after search and filters; null while not searching. */
    matchCount: number | null;
  };
  minLevel: LevelThreshold;
  onMinLevelChange: (value: LevelThreshold) => void;
  status: {
    active: StatusGroup[];
    counts: Partial<Record<StatusGroup, number>>;
    onToggle: (group: StatusGroup) => void;
  };
  more: Omit<LogMorePopoverProps, 'actions'>;
  actions: LogToolbarActions;
}

const STATUS_LAMP: Partial<Record<StatusGroup, 'warn' | 'fault'>> = {
  '4xx': 'warn',
  '5xx': 'fault',
};

function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  danger,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  danger?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={[styles.iconButton, danger ? styles.danger : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function LogToolbar({
  live,
  search,
  minLevel,
  onMinLevelChange,
  status,
  more,
  actions,
}: LogToolbarProps) {
  const { t, i18n } = useTranslation();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Mobile: the filter strip scrolls sideways; edge fades show there is more to reach.
  // Written straight to data attributes so scrolling never re-renders the toolbar.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const update = () => {
      const overflow = strip.scrollWidth - strip.clientWidth;
      strip.dataset.fadeStart = String(overflow > 1 && strip.scrollLeft > 1);
      strip.dataset.fadeEnd = String(overflow > 1 && overflow - strip.scrollLeft > 1);
    };
    update();
    strip.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    for (const child of Array.from(strip.children)) observer.observe(child);
    return () => {
      strip.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  // "/" jumps to search, as in most log consoles.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))
        return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const clock = formatUpdatedClock(live.lastUpdated, i18n.language);
  const readStatus = t(
    live.enabled && live.catchingUp
      ? 'logs.read_status_catching_up'
      : live.enabled
        ? 'logs.read_status_live'
        : 'logs.read_status_paused'
  );
  const liveTitle = clock
    ? `${readStatus} · ${t('logs.last_updated', { time: clock })}`
    : readStatus;
  const levelLabels: Record<LevelThreshold, string> = {
    '': t('logs.level_all'),
    warn: t('logs.level_warn_plus'),
    error: t('logs.level_error'),
  };
  const levelTitles: Record<LevelThreshold, string> = {
    '': t('logs.all_levels'),
    warn: t('logs.level_warn_plus_title'),
    error: t('logs.level_error_title'),
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.live}
          data-live={live.enabled}
          onClick={live.onToggle}
          disabled={live.disabled}
          aria-pressed={live.enabled}
          aria-label={t('logs.reading_enabled')}
          title={liveTitle}
        >
          {live.enabled ? (
            <StatusLamp state="ok" live size={6} />
          ) : (
            <IconPause size={11} className={styles.pauseIcon} />
          )}
          <span className={styles.liveLabel}>
            {live.enabled
              ? live.catchingUp
                ? t('logs.catching_up')
                : t('logs.live')
              : t('logs.paused')}
          </span>
        </button>

        <div className={styles.search}>
          <IconSearch size={14} className={styles.searchIcon} />
          <input
            ref={searchRef}
            className={styles.searchInput}
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && search.value) {
                event.preventDefault();
                search.onChange('');
              }
            }}
            placeholder={t('logs.search_short')}
            aria-label={t('logs.search_placeholder')}
            spellCheck={false}
            autoComplete="off"
          />
          {search.matchCount !== null ? (
            <span className={styles.matchCount} aria-live="polite">
              {t('logs.search_matches', { count: search.matchCount })}
            </span>
          ) : null}
          {search.value ? (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => {
                search.onChange('');
                searchRef.current?.focus();
              }}
              title={t('logs.clear_search')}
              aria-label={t('logs.clear_search')}
            >
              <IconX size={14} />
            </button>
          ) : (
            <kbd className={styles.searchKey} aria-hidden="true">
              /
            </kbd>
          )}
        </div>

        <div className={styles.strip} ref={stripRef}>
          <div className={styles.segmented} role="group" aria-label={t('logs.level_filter')}>
            {LEVEL_THRESHOLDS.map((value) => (
              <button
                key={value || 'all'}
                type="button"
                className={styles.segment}
                aria-pressed={minLevel === value}
                title={levelTitles[value]}
                onClick={() => onMinLevelChange(value)}
              >
                {levelLabels[value]}
              </button>
            ))}
          </div>

          <div className={styles.segmented} role="group" aria-label={t('logs.filter_status')}>
            {STATUS_GROUPS.map((group) => {
              const active = status.active.includes(group);
              const count = status.counts[group] ?? 0;
              const lamp = STATUS_LAMP[group];
              return (
                <button
                  key={group}
                  type="button"
                  className={styles.segment}
                  aria-pressed={active}
                  disabled={count === 0 && !active}
                  onClick={() => status.onToggle(group)}
                >
                  {lamp && count > 0 ? <StatusLamp state={lamp} size={6} /> : null}
                  {t(`logs.filter_status_${group}`)}
                  <span className={styles.segmentCount}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <LogMorePopover {...more} actions={actions} />

        <div className={styles.actions}>
          <IconButton
            label={t('logs.refresh_button')}
            onClick={actions.onRefresh}
            disabled={actions.refreshDisabled}
          >
            <IconRefreshCw size={15} className={actions.refreshing ? styles.spinning : undefined} />
          </IconButton>
          <IconButton
            label={t('logs.download_cached')}
            onClick={actions.onDownload}
            disabled={actions.downloadDisabled}
            className={styles.desktopOnly}
          >
            <IconDownload size={15} />
          </IconButton>
          <IconButton
            label={
              actions.fullscreen ? t('logs.exit_fullscreen_button') : t('logs.fullscreen_button')
            }
            onClick={actions.onToggleFullscreen}
            pressed={actions.fullscreen}
            className={styles.desktopOnly}
          >
            {actions.fullscreen ? <IconMinimize2 size={15} /> : <IconMaximize2 size={15} />}
          </IconButton>
          <span className={`${styles.divider} ${styles.desktopOnly}`} aria-hidden="true" />
          <IconButton
            label={t('logs.clear_button')}
            onClick={actions.onClear}
            disabled={actions.clearDisabled}
            danger
            className={styles.desktopOnly}
          >
            <IconTrash2 size={15} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

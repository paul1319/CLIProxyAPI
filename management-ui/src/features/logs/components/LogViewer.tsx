import type { ReactNode, RefObject, UIEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowDown, IconScrollText } from '@/components/ui/icons';
import type { LogEntry } from '../model/logSelectors';
import { LogRow } from './LogRow';
import styles from './LogViewer.module.scss';

export type LogViewerEmpty =
  { kind: 'loading' } | { kind: 'message'; text: string; detail?: string; action?: ReactNode };

interface LogViewerProps {
  viewerRef: RefObject<HTMLDivElement | null>;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  /** When set, replaces the scrolling region (loading, empty, filtered-out, file logging off). */
  empty: LogViewerEmpty | null;
  loading: boolean;
  lines: LogEntry[];
  hiddenAbove: number;
  canLoadMore: boolean;
  onLoadMore: () => void;
  raw: boolean;
  wrap: boolean;
  showIp: boolean;
  showSource: boolean;
  query: string;
  isFollowing: boolean;
  pendingLines: number;
  onResume: () => void;
  onOpenRequest: (requestId: string) => void;
  onCopy: (raw: string) => void;
  statusBar: ReactNode;
}

const SKELETON_WIDTHS = [72, 64, 80, 58, 76, 69, 84, 61, 74, 66];

export function LogViewer({
  viewerRef,
  onScroll,
  empty,
  loading,
  lines,
  hiddenAbove,
  canLoadMore,
  onLoadMore,
  raw,
  wrap,
  showIp,
  showSource,
  query,
  isFollowing,
  pendingLines,
  onResume,
  onOpenRequest,
  onCopy,
  statusBar,
}: LogViewerProps) {
  const { t } = useTranslation();

  const listClassName = [
    styles.list,
    showIp ? styles.withIp : '',
    showSource ? '' : styles.noSource,
    wrap ? styles.wrapped : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.surface}>
      {empty?.kind === 'loading' ? (
        <div className={styles.skeleton} role="status" aria-label={t('logs.loading')}>
          {SKELETON_WIDTHS.map((width, index) => (
            <span key={index} className={styles.skeletonLine} style={{ width: `${width}%` }} />
          ))}
        </div>
      ) : empty ? (
        <div className={styles.empty} role="status">
          <span className={styles.emptyIcon} aria-hidden="true">
            <IconScrollText size={16} />
          </span>
          <p className={styles.emptyText}>{empty.text}</p>
          {empty.detail ? <p className={styles.emptyDetail}>{empty.detail}</p> : null}
          {empty.action ? <div className={styles.emptyAction}>{empty.action}</div> : null}
        </div>
      ) : (
        <div
          ref={viewerRef}
          className={styles.scroll}
          onScroll={onScroll}
          tabIndex={0}
          role="region"
          aria-label={t('logs.log_content')}
          aria-busy={loading}
        >
          {canLoadMore ? (
            <div className={styles.earlier}>
              <span>{t('logs.hidden_lines', { count: hiddenAbove })}</span>
              <button type="button" className={styles.earlierButton} onClick={onLoadMore}>
                {t('logs.filter_load_more')}
              </button>
            </div>
          ) : null}
          {raw ? (
            <pre className={`${styles.raw} ${wrap ? styles.rawWrapped : ''}`} spellCheck={false}>
              {lines.map((line) => (
                <span key={line.id} data-log-id={line.id} className={styles.rawLine}>
                  {line.raw || ' '}
                </span>
              ))}
            </pre>
          ) : (
            <div className={listClassName}>
              {lines.map((line) => (
                <LogRow
                  key={line.id}
                  line={line}
                  query={query}
                  showIp={showIp}
                  showSource={showSource}
                  onOpenRequest={onOpenRequest}
                  onCopy={onCopy}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!empty && !isFollowing ? (
        <button type="button" className={styles.newPill} onClick={onResume}>
          <IconArrowDown size={14} />
          {pendingLines > 0 ? t('logs.new_lines', { count: pendingLines }) : t('logs.jump_latest')}
        </button>
      ) : null}

      {statusBar}
    </div>
  );
}

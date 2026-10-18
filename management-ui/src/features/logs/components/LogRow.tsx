import { memo } from 'react';
import type { TFunction } from 'i18next';
import { IconCopy } from '@/components/ui/icons';
import type { LogEntry } from '../model/logSelectors';
import {
  formatLogClock,
  isFaultRow,
  isRequestLine,
  levelTone,
  splitHighlight,
  statusTone,
} from '../model/logDisplay';
import styles from './LogViewer.module.scss';

const TONE_CLASS: Record<string, string> = {
  quiet: styles.toneQuiet,
  dim: styles.toneDim,
  warn: styles.toneWarn,
  fault: styles.toneFault,
};

function Highlight({ text, query }: { text?: string; query: string }) {
  if (!text) return null;
  if (!query) return <>{text}</>;
  return (
    <>
      {splitHighlight(text, query).map((segment, index) =>
        segment.match ? (
          <mark key={index} className={styles.hit}>
            {segment.text}
          </mark>
        ) : (
          segment.text
        )
      )}
    </>
  );
}

interface LogRowProps {
  line: LogEntry;
  query: string;
  showIp: boolean;
  showSource: boolean;
  onOpenRequest: (requestId: string) => void;
  onCopy: (raw: string) => void;
  t: TFunction;
}

function LogRowView({ line, query, showIp, showSource, onOpenRequest, onCopy, t }: LogRowProps) {
  const request = isRequestLine(line);
  const className = [styles.row, isFaultRow(line) ? styles.rowFault : ''].filter(Boolean).join(' ');

  return (
    <div data-log-id={line.id} className={className}>
      <span className={styles.cTime} title={line.timestamp}>
        {formatLogClock(line.timestamp)}
      </span>
      <span className={`${styles.cLevel} ${TONE_CLASS[levelTone(line.level)]}`}>
        {line.level?.toUpperCase()}
      </span>
      {request ? (
        <>
          <span className={`${styles.cStatus} ${TONE_CLASS[statusTone(line.statusCode)]}`}>
            {line.statusCode}
          </span>
          <span className={styles.cLatency}>{line.latency}</span>
          {showIp ? (
            <span className={styles.cIp} title={line.ip}>
              <Highlight text={line.ip} query={query} />
            </span>
          ) : null}
          <span className={styles.cMethod}>{line.method}</span>
          <span className={styles.cPath} title={line.path}>
            <Highlight text={line.path} query={query} />
            {line.message ? (
              <span className={styles.trail}>
                {line.path ? ' ' : null}
                <Highlight text={line.message} query={query} />
              </span>
            ) : null}
          </span>
        </>
      ) : (
        <span className={styles.cMessage}>
          <Highlight text={line.message} query={query} />
        </span>
      )}
      <span className={styles.cRid}>
        {line.requestId ? (
          <button
            type="button"
            className={styles.rid}
            title={t('logs.view_request', { id: line.requestId })}
            aria-label={t('logs.view_request', { id: line.requestId })}
            onClick={() => onOpenRequest(line.requestId as string)}
          >
            <Highlight text={line.requestId} query={query} />
          </button>
        ) : null}
      </span>
      {showSource ? (
        <span className={styles.cSource} title={line.source}>
          <Highlight text={line.source} query={query} />
        </span>
      ) : null}
      <span className={styles.cCopy}>
        <button
          type="button"
          className={styles.copy}
          title={t('logs.copy_line')}
          aria-label={t('logs.copy_line')}
          onClick={() => onCopy(line.raw)}
        >
          <IconCopy size={13} />
        </button>
      </span>
    </div>
  );
}

/** Rows are memoized: parsed entries keep their identity across incremental reads. */
export const LogRow = memo(LogRowView);

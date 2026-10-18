import { useTranslation } from 'react-i18next';
import { StatusLamp } from '@/components/ui/StatusLamp';
import styles from './LogViewer.module.scss';

interface LogStatusBarProps {
  cached: number;
  matched: number;
  cursorReset: boolean;
  historyEvicted: boolean;
  wrap: boolean;
  raw: boolean;
}

/** Slim footer inside the log surface: scope of the loaded window and actionable notices. */
export function LogStatusBar({
  cached,
  matched,
  cursorReset,
  historyEvicted,
  wrap,
  raw,
}: LogStatusBarProps) {
  const { t } = useTranslation();
  const modes = [raw ? t('logs.show_raw_logs') : '', wrap ? t('logs.wrap_lines') : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <footer className={styles.statusBar}>
      <span
        className={styles.statusLines}
        title={t('logs.buffer_scope', { count: cached, matched })}
      >
        {t('logs.status_lines', { matched, count: cached })}
      </span>
      {cursorReset ? (
        <span className={styles.statusNotice} role="status">
          <StatusLamp state="warn" size={6} />
          {t('logs.cursor_reset_notice')}
        </span>
      ) : null}
      {historyEvicted ? (
        <span className={styles.statusNotice} role="status">
          <StatusLamp state="warn" size={6} />
          {t('logs.history_evicted')}
        </span>
      ) : null}
      {modes ? <span className={styles.statusEnd}>{modes}</span> : null}
    </footer>
  );
}

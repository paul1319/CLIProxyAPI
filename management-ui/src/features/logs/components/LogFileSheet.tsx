import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { IconCopy, IconDownload } from '@/components/ui/icons';
import { formatUnixTimestamp } from '@/utils/format';
import type { ErrorLogViewerState } from '../model/errorLogViewer';
import { formatLogFileSize } from '../model/logDisplay';
import styles from './LogFiles.module.scss';

interface LogFileSheetProps {
  viewer: ErrorLogViewerState;
  /** Set when the sheet shows a per-request log opened from a log row. */
  requestId: string | null;
  downloading: boolean;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

/** Right-side reader shared by error request files and per-request logs. */
export function LogFileSheet({
  viewer,
  requestId,
  downloading,
  onClose,
  onCopy,
  onDownload,
}: LogFileSheetProps) {
  const { t } = useTranslation();
  const item = viewer.status === 'closed' ? null : viewer.item;
  const size = formatLogFileSize(item?.size);
  const modified = item?.modified ? formatUnixTimestamp(item.modified) : '';
  const meta = [size, modified].filter(Boolean).join(' · ');

  return (
    <Sheet
      open={viewer.status !== 'closed'}
      onClose={onClose}
      size="xl"
      eyebrow={requestId ? t('logs.sheet_request_log') : t('logs.sheet_error_log')}
      title={
        item ? (
          <span className={styles.sheetTitle}>
            {requestId ? t('logs.request_log_title', { id: requestId }) : item.name}
          </span>
        ) : (
          t('logs.error_log_view_title')
        )
      }
      description={meta || undefined}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={onCopy}
            disabled={viewer.status !== 'ready' || !viewer.text}
          >
            <IconCopy size={14} />
            {t('common.copy')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onDownload}
            loading={downloading}
            disabled={viewer.status === 'closed' || viewer.status === 'loading'}
          >
            <IconDownload size={14} />
            {t('logs.error_logs_download')}
          </Button>
        </>
      }
    >
      {viewer.status === 'loading' ? (
        <div className={styles.sheetSkeleton} role="status" aria-label={t('common.loading')}>
          {[88, 72, 94, 60, 81, 67, 90, 54].map((width, index) => (
            <span key={index} style={{ width: `${width}%` }} />
          ))}
        </div>
      ) : null}
      {viewer.status === 'error' ? (
        <div className={styles.sheetError} role="alert">
          {viewer.message}
        </div>
      ) : null}
      {viewer.status === 'ready' ? (
        viewer.text ? (
          <pre className={styles.sheetContent} spellCheck={false}>
            {viewer.text}
          </pre>
        ) : (
          <p className={styles.sheetEmpty}>{t('logs.error_log_empty_content')}</p>
        )
      ) : null}
    </Sheet>
  );
}

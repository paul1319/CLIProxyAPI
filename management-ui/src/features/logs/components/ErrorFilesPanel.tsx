import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { IconDownload, IconEye, IconRefreshCw } from '@/components/ui/icons';
import type { ErrorLogFile } from '@/services/api/logs';
import { useNow } from '@/hooks/useNow';
import { formatRelativeInstant } from '@/utils/quota';
import { formatUnixTimestamp } from '@/utils/format';
import { formatLogFileSize } from '../model/logDisplay';
import styles from './LogFiles.module.scss';

interface ErrorFilesPanelProps {
  files: ErrorLogFile[];
  loading: boolean;
  loaded: boolean;
  error: string;
  requestLogEnabled: boolean;
  disabled: boolean;
  onRefresh: () => void;
  onOpen: (file: ErrorLogFile) => void;
  onDownload: (name: string) => void;
}

/** Unix seconds or milliseconds → milliseconds. */
const toMs = (value: number) => (Math.abs(value) < 1e11 ? value * 1000 : value);

export function ErrorFilesPanel({
  files,
  loading,
  loaded,
  error,
  requestLogEnabled,
  disabled,
  onRefresh,
  onOpen,
  onDownload,
}: ErrorFilesPanelProps) {
  const { t, i18n } = useTranslation();
  const sorted = useMemo(
    () => [...files].sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0)),
    [files]
  );
  const now = useNow();

  const refreshButton = (
    <Button variant="secondary" size="sm" onClick={onRefresh} loading={loading} disabled={disabled}>
      {!loading ? <IconRefreshCw size={14} /> : null}
      {t('common.refresh')}
    </Button>
  );

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <p className={styles.hint}>
          {sorted.length > 0 ? (
            <span className={styles.count}>
              {t('logs.error_logs_count', { count: sorted.length })}
            </span>
          ) : null}
          {t('logs.error_logs_description')}
        </p>
        {refreshButton}
      </div>

      {error ? (
        <div className={styles.inlineError} role="alert">
          <span>{error}</span>
          <button type="button" className={styles.retry} onClick={onRefresh} disabled={disabled}>
            {t('common.refresh')}
          </button>
        </div>
      ) : null}

      {loading && !loaded ? (
        <div className={styles.tableSkeleton} role="status" aria-label={t('common.loading')}>
          {[64, 52, 70].map((width, index) => (
            <span key={index} style={{ width: `${width}%` }} />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        error ? null : requestLogEnabled ? (
          <EmptyState
            title={t('logs.error_logs_request_log_enabled_title')}
            description={t('logs.error_logs_request_log_enabled')}
          />
        ) : (
          <EmptyState title={t('logs.error_logs_empty')} />
        )
      ) : (
        <div className={styles.tableWrap}>
          <Table className={styles.table}>
            <TableHeader>
              <tr>
                <TableHead>{t('logs.files_name')}</TableHead>
                <TableHead alignRight className={styles.colSize}>
                  {t('logs.error_logs_size')}
                </TableHead>
                <TableHead className={styles.colModified}>
                  {t('logs.error_logs_modified')}
                </TableHead>
                <TableHead alignRight>
                  <span className={styles.srOnly}>{t('common.action')}</span>
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {sorted.map((file) => {
                const size = formatLogFileSize(file.size);
                const modifiedMs = file.modified ? toMs(file.modified) : null;
                const relative =
                  modifiedMs !== null ? formatRelativeInstant(modifiedMs, now, i18n.language) : '';
                const absolute = file.modified ? formatUnixTimestamp(file.modified) : '';
                return (
                  <TableRow key={file.name}>
                    <TableCell className={styles.cellName}>
                      <span className={styles.fileName}>{file.name}</span>
                      <span className={styles.fileMetaMobile}>
                        {[size, relative].filter(Boolean).join(' · ')}
                      </span>
                    </TableCell>
                    <TableCell alignRight className={`${styles.colSize} ${styles.cellNum}`}>
                      {size || <span className={styles.unknown}>—</span>}
                    </TableCell>
                    <TableCell className={`${styles.colModified} ${styles.cellMeta}`}>
                      {relative ? (
                        <span title={absolute}>{relative}</span>
                      ) : (
                        <span className={styles.unknown}>—</span>
                      )}
                    </TableCell>
                    <TableCell alignRight className={styles.cellActions}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpen(file)}
                        disabled={disabled}
                      >
                        <IconEye size={14} />
                        {t('logs.error_logs_open')}
                      </Button>
                      <button
                        type="button"
                        className={styles.iconAction}
                        onClick={() => onDownload(file.name)}
                        disabled={disabled}
                        title={t('logs.error_logs_download')}
                        aria-label={`${t('logs.error_logs_download')} ${file.name}`}
                      >
                        <IconDownload size={15} />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

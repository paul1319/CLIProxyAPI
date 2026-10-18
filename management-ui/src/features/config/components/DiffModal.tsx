import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { computeUnifiedDiff, type DiffResult } from '../unifiedDiff';
import styles from './DiffModal.module.scss';

type DiffModalProps = {
  open: boolean;
  original: string;
  modified: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
};

export function DiffModal({
  open,
  original,
  modified,
  onConfirm,
  onCancel,
  loading = false,
}: DiffModalProps) {
  const { t } = useTranslation();

  const diff = useMemo<DiffResult>(
    () => computeUnifiedDiff(original, modified),
    [original, modified]
  );

  return (
    <Modal
      open={open}
      title={t('config_management.diff.title')}
      onClose={onCancel}
      width="min(1040px, 92vw)"
      className={styles.diffModal}
      closeDisabled={loading}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onConfirm} loading={loading} disabled={loading}>
            {t('config_management.diff.confirm')}
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        {diff.hunks.length === 0 ? (
          <div className={styles.emptyState}>{t('config_management.diff.no_changes')}</div>
        ) : (
          <div className={styles.diffContainer}>
            <div className={styles.fileHeader}>
              <span className={styles.fileName}>config.yaml</span>
              <span className={styles.fileStats}>
                <span className={styles.statAdditions}>+{diff.additions}</span>
                <span className={styles.statDeletions}>−{diff.deletions}</span>
              </span>
            </div>

            <div className={styles.diffBody} role="table" aria-label="config.yaml">
              {diff.hunks.map((hunk, hunkIdx) => (
                <div key={hunkIdx} className={styles.hunk} role="rowgroup">
                  <div className={styles.hunkHeader} role="row">
                    <span className={styles.hunkText} role="cell">
                      @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                    </span>
                  </div>

                  {hunk.lines.map((line, lineIdx) => (
                    <div
                      key={`${hunkIdx}-${lineIdx}`}
                      className={`${styles.diffLine} ${styles[line.type]}`}
                      role="row"
                    >
                      <span className={styles.lineNum} role="cell">
                        {line.oldNum ?? ''}
                      </span>
                      <span className={styles.lineNum} role="cell">
                        {line.newNum ?? ''}
                      </span>
                      <span className={styles.linePrefix} role="cell">
                        {line.type === 'deletion' ? '−' : line.type === 'addition' ? '+' : ' '}
                      </span>
                      <code className={styles.lineText} role="cell">
                        {line.text || ' '}
                      </code>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

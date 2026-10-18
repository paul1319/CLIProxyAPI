import { useId, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { IconFileText, IconLoader2, IconUpload } from '@/components/ui/icons';
import type { VertexImportState } from '../hooks/useVertexImport';
import { DialogTitle, ResultView, type DialogHeading } from './OAuthFlowDialog';
import dialogStyles from './OAuthFlowDialog.module.scss';
import styles from './VertexImportDialog.module.scss';

export interface VertexImportDialogProps {
  open: boolean;
  heading: DialogHeading;
  vertex: VertexImportState;
  onPickFile: (file: File | undefined) => void;
  onLocationChange: (value: string) => void;
  onImport: () => void;
  onImportAnother: () => void;
  onViewAuthFiles: () => void;
  onClose: () => void;
}

export function VertexImportDialog({
  open,
  heading,
  vertex,
  onPickFile,
  onLocationChange,
  onImport,
  onImportAnother,
  onViewAuthFiles,
  onClose,
}: VertexImportDialogProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileLabelId = useId();
  const fileHintId = useId();
  const [dragging, setDragging] = useState(false);
  const result = vertex.result;

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    onPickFile(event.dataTransfer.files?.[0]);
  };

  const resultRows = result
    ? [
        { key: 'result_project', value: result.projectId },
        { key: 'result_email', value: result.email },
        { key: 'result_location', value: result.location },
        { key: 'result_file', value: result.authFile },
      ].filter((row): row is { key: string; value: string } => Boolean(row.value))
    : [];

  const footer = result ? undefined : (
    <button
      type="button"
      className="btn btn-primary"
      onClick={onImport}
      disabled={!vertex.file || vertex.loading}
    >
      {vertex.loading && (
        <IconLoader2 size={14} className={dialogStyles.spinning} aria-hidden="true" />
      )}
      {t('vertex_import.import_button')}
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={520}
      className={dialogStyles.dialog}
      title={<DialogTitle {...heading} />}
      footer={footer}
    >
      <div className={dialogStyles.view} key={result ? 'result' : 'form'}>
        {result ? (
          <ResultView
            title={t('vertex_import.result_title')}
            actions={
              <>
                <button type="button" className="btn btn-secondary" onClick={onViewAuthFiles}>
                  {t('auth_login.view_auth_files')}
                </button>
                <button type="button" className="btn btn-primary" onClick={onImportAnother}>
                  {t('vertex_import.import_another')}
                </button>
              </>
            }
          >
            {resultRows.length > 0 && (
              <dl className={styles.facts}>
                {resultRows.map((row) => (
                  <div className={styles.fact} key={row.key}>
                    <dt>{t(`vertex_import.${row.key}`)}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </ResultView>
        ) : (
          <div className={dialogStyles.stack}>
            <p className={dialogStyles.hint}>{t('vertex_import.description')}</p>

            <div className={styles.field}>
              <span className={styles.label} id={fileLabelId}>
                {t('vertex_import.file_label')}
              </span>
              <button
                type="button"
                className={styles.dropZone}
                data-dragging={dragging}
                data-filled={Boolean(vertex.file)}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                aria-describedby={`${fileLabelId} ${fileHintId}`}
              >
                <span className={styles.dropGlyph} aria-hidden="true">
                  {vertex.file ? <IconFileText size={16} /> : <IconUpload size={16} />}
                </span>
                <span className={styles.dropText}>
                  <span className={vertex.file ? styles.fileName : styles.dropTitle}>
                    {vertex.file ? vertex.file.name : t('vertex_import.drop_hint')}
                  </span>
                  <span className={styles.dropHint} id={fileHintId}>
                    {vertex.file ? t('vertex_import.choose_file') : t('vertex_import.file_hint')}
                  </span>
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => {
                  onPickFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </div>

            <div className={styles.locationField}>
              <Input
                label={t('vertex_import.location_label')}
                hint={t('vertex_import.location_hint')}
                value={vertex.location}
                onChange={(event) => onLocationChange(event.target.value)}
                placeholder={t('vertex_import.location_placeholder')}
                spellCheck={false}
              />
            </div>

            {vertex.error && (
              <div className={dialogStyles.alert} role="alert">
                {vertex.error}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

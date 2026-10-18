import { useTranslation } from 'react-i18next';
import { IconCopy } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { isModelExcluded, type AuthFileModelItem } from '@/features/authFiles/constants';
import styles from './AuthFileDetailsSheet.module.scss';

export type AuthFileModelsListProps = {
  fileType: string;
  loading: boolean;
  error: 'unsupported' | null;
  models: AuthFileModelItem[];
  excluded: Record<string, string[]>;
  onCopyText: (text: string) => void;
};

/** Models served by one credential; each row is a real button that copies the model id. */
export function AuthFileModelsList({
  fileType,
  loading,
  error,
  models,
  excluded,
  onCopyText,
}: AuthFileModelsListProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className={styles.modelSkeleton} aria-busy="true">
        {[64, 52, 72, 44].map((width, index) => (
          <Skeleton key={index} width={`${width}%`} height={10} rounded={3} />
        ))}
      </div>
    );
  }
  if (error === 'unsupported') {
    return (
      <p className={styles.mutedNote}>
        {t('auth_files.models_unsupported')} · {t('auth_files.models_unsupported_desc')}
      </p>
    );
  }
  if (models.length === 0) {
    return <p className={styles.mutedNote}>{t('auth_files.models_empty_desc')}</p>;
  }

  return (
    <ul className={styles.modelList}>
      {models.map((model) => {
        const excludedModel = isModelExcluded(model.id, fileType, excluded);
        return (
          <li key={model.id}>
            <button
              type="button"
              className={`${styles.modelItem} ${excludedModel ? styles.modelItemExcluded : ''}`}
              onClick={() => onCopyText(model.id)}
              title={
                excludedModel
                  ? t('auth_files.models_excluded_hint')
                  : t('credentials.copy_model_id')
              }
            >
              <span className={styles.modelId}>{model.id}</span>
              {model.display_name && model.display_name !== model.id && (
                <span className={styles.modelName}>{model.display_name}</span>
              )}
              {excludedModel && (
                <span className={styles.modelBadge}>{t('auth_files.models_excluded_badge')}</span>
              )}
              <IconCopy size={13} className={styles.modelCopy} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

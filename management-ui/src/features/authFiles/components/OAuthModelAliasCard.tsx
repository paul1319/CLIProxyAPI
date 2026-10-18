import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ModelMappingDiagram, type ModelMappingDiagramRef } from '@/components/modelAlias';
import { IconChevronUp, IconPlus } from '@/components/ui/icons';
import type { OAuthModelAliasEntry } from '@/types';
import type { AuthFileModelItem, OAuthConfigLoadError } from '@/features/authFiles/constants';
import { OAuthRulePanel } from './OAuthRulePanel';
import styles from './OAuthConfigPanels.module.scss';

type ViewMode = 'diagram' | 'list';

export type OAuthModelAliasCardProps = {
  disableControls: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onRetry: () => void | Promise<void>;
  onAdd: () => void;
  onEditProvider: (provider?: string) => void;
  onDeleteProvider: (provider: string) => void;
  modelAliasError: OAuthConfigLoadError;
  modelAlias: Record<string, OAuthModelAliasEntry[]>;
  allProviderModels: Record<string, AuthFileModelItem[]>;
  onUpdate: (provider: string, sourceModel: string, newAlias: string) => Promise<void>;
  onDeleteLink: (provider: string, sourceModel: string, alias: string) => void;
  onToggleFork: (
    provider: string,
    sourceModel: string,
    alias: string,
    fork: boolean
  ) => Promise<void>;
  onRenameAlias: (oldAlias: string, newAlias: string) => Promise<void>;
  onDeleteAlias: (aliasName: string) => void;
};

/** Provider-wide OAuth model aliases, as a list or as the mapping diagram. */
export function OAuthModelAliasCard(props: OAuthModelAliasCardProps) {
  const { t } = useTranslation();
  const diagramRef = useRef<ModelMappingDiagramRef | null>(null);
  const {
    disableControls,
    viewMode,
    onViewModeChange,
    onRetry,
    onAdd,
    onEditProvider,
    onDeleteProvider,
    modelAliasError,
    modelAlias,
    allProviderModels,
    onUpdate,
    onDeleteLink,
    onToggleFork,
    onRenameAlias,
    onDeleteAlias,
  } = props;
  const hasAliases = Object.keys(modelAlias).length > 0;
  const controlsDisabled = disableControls || modelAliasError !== null;

  return (
    <OAuthRulePanel
      title={t('credentials.rules_alias_title')}
      description={t('credentials.rules_alias_desc')}
      actions={
        <>
          <div
            className={styles.viewModeSwitch}
            role="group"
            aria-label={t('credentials.rules_view_mode')}
          >
            {(['list', 'diagram'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`${styles.viewModeButton} ${viewMode === mode ? styles.viewModeActive : ''}`}
                onClick={() => onViewModeChange(mode)}
                disabled={controlsDisabled}
                aria-pressed={viewMode === mode}
              >
                {t(`oauth_model_alias.view_mode_${mode}`)}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={onAdd} disabled={controlsDisabled}>
            <IconPlus size={14} />
            {t('credentials.rules_add_alias')}
          </Button>
        </>
      }
      loadError={modelAliasError}
      upgradeTitle={t('oauth_model_alias.upgrade_required_title')}
      upgradeDescription={t('oauth_model_alias.upgrade_required_desc')}
      emptyText={t('credentials.rules_alias_empty')}
      rows={Object.entries(modelAlias).map(([provider, mappings]) => ({
        provider,
        count: mappings?.length ?? 0,
        preview: (mappings ?? []).map((entry) => `${entry.name} → ${entry.alias}`),
      }))}
      countLabel={(count) =>
        count ? t('credentials.rules_alias_count', { count }) : t('oauth_model_alias.no_models')
      }
      deleteLabel={t('oauth_model_alias.delete')}
      disableControls={disableControls}
      onRetry={onRetry}
      onEdit={onEditProvider}
      onDelete={onDeleteProvider}
    >
      {viewMode === 'diagram' && hasAliases ? (
        <div className={styles.aliasChartSection}>
          <div className={styles.aliasChartHeader}>
            <h3 className={styles.aliasChartTitle}>{t('oauth_model_alias.chart_title')}</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => diagramRef.current?.collapseAll()}
              disabled={controlsDisabled}
              title={t('oauth_model_alias.diagram_collapse')}
              aria-label={t('oauth_model_alias.diagram_collapse')}
            >
              <IconChevronUp size={16} />
            </Button>
          </div>
          <ModelMappingDiagram
            ref={diagramRef}
            modelAlias={modelAlias}
            allProviderModels={allProviderModels}
            onUpdate={onUpdate}
            onDeleteLink={onDeleteLink}
            onToggleFork={onToggleFork}
            onRenameAlias={onRenameAlias}
            onDeleteAlias={onDeleteAlias}
            onEditProvider={onEditProvider}
            onDeleteProvider={onDeleteProvider}
            className={styles.aliasChart}
          />
        </div>
      ) : undefined}
    </OAuthRulePanel>
  );
}

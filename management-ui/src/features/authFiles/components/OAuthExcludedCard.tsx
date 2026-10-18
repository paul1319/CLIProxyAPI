import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconPlus } from '@/components/ui/icons';
import type { OAuthConfigLoadError } from '@/features/authFiles/constants';
import { OAuthRulePanel } from './OAuthRulePanel';

export type OAuthExcludedCardProps = {
  disableControls: boolean;
  excludedError: OAuthConfigLoadError;
  excluded: Record<string, string[]>;
  onRetry: () => void | Promise<void>;
  onAdd: () => void;
  onEdit: (provider: string) => void;
  onDelete: (provider: string) => void;
};

/** Provider-wide OAuth model exclusions (applies to every account of the provider). */
export function OAuthExcludedCard(props: OAuthExcludedCardProps) {
  const { t } = useTranslation();
  const { disableControls, excludedError, excluded, onRetry, onAdd, onEdit, onDelete } = props;

  return (
    <OAuthRulePanel
      title={t('credentials.rules_excluded_title')}
      description={t('credentials.rules_excluded_desc')}
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={onAdd}
          disabled={disableControls || excludedError !== null}
        >
          <IconPlus size={14} />
          {t('credentials.rules_add_exclusion')}
        </Button>
      }
      loadError={excludedError}
      upgradeTitle={t('oauth_excluded.upgrade_required_title')}
      upgradeDescription={t('oauth_excluded.upgrade_required_desc')}
      emptyText={t('credentials.rules_excluded_empty')}
      rows={Object.entries(excluded).map(([provider, models]) => ({
        provider,
        count: models?.length ?? 0,
        preview: models ?? [],
      }))}
      countLabel={(count) =>
        count ? t('credentials.rules_model_count', { count }) : t('oauth_excluded.no_models')
      }
      deleteLabel={t('oauth_excluded.delete')}
      disableControls={disableControls}
      onRetry={onRetry}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

import { memo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { StatusLamp } from '@/components/ui/StatusLamp';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconDownload,
  IconInfo,
  IconKey,
  IconModelCluster,
  IconMoreHorizontal,
  IconRefreshCw,
  IconTimer,
  IconTrash2,
} from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { AuthFileItem } from '@/types';
import { formatRelativeInstant } from '@/utils/quota';
import type { StatusBarData } from '@/utils/recentRequests';
import {
  getTypeLabel,
  isRuntimeOnlyAuthFile,
  supportsAuthFileManualRefresh,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import { getCredentialLampState } from '@/components/layout/poolRail';
import { formatCooldownLine } from '@/features/authFiles/cooldowns';
import {
  getAuthFileHealth,
  getAuthFileProviderKey,
  resolveAuthFileQuotaType,
} from '@/features/authFiles/logic';
import { getAuthFileRefreshKey } from '@/features/authFiles/manualRefresh';
import { describeAuthFileProblem, readLastRefreshMs } from '@/features/authFiles/rowModel';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { ActivitySparkline } from './ActivitySparkline';
import { useAuthFileQuotaHeadline } from '@/features/authFiles/hooks/useAuthFileQuotaHeadline';
import { AuthFileQuotaCell } from './AuthFileQuotaCell';
import { ProviderGlyph } from './ProviderGlyph';
import styles from './AuthFilesTable.module.scss';

export type AuthFileRowSection = 'overview' | 'models';

export type AuthFileRowProps = {
  file: AuthFileItem;
  selected: boolean;
  /** Mobile hides checkboxes until "Select" mode is on. */
  selectionMode: boolean;
  resolvedTheme: ResolvedTheme;
  disableControls: boolean;
  deleting: string | null;
  statusUpdating: Record<string, boolean>;
  manualRefreshing: Record<string, boolean>;
  cooldownResetting: Record<string, boolean>;
  activity: StatusBarData;
  activityMax: number;
  onOpenDetails: (file: AuthFileItem, section?: AuthFileRowSection) => void;
  onToggleSelect: (name: string) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onDownload: (name: string) => void;
  onManualRefresh: (file: AuthFileItem) => void;
  onCooldownReset: (file: AuthFileItem) => void;
  onRefreshQuota: (file: AuthFileItem, quotaType: QuotaProviderType) => void;
  onDelete: (name: string) => void;
};

/** Clicks on these never open the details sheet (they carry their own action). */
const ROW_INTERACTIVE_SELECTOR = 'button, a, input, label, [role="menu"]';

function AuthFileRowView(props: AuthFileRowProps) {
  const { t, i18n } = useTranslation();
  const {
    file,
    selected,
    selectionMode,
    resolvedTheme,
    disableControls,
    deleting,
    statusUpdating,
    manualRefreshing,
    cooldownResetting,
    activity,
    activityMax,
    onOpenDetails,
    onToggleSelect,
    onToggleStatus,
    onDownload,
    onManualRefresh,
    onCooldownReset,
    onRefreshQuota,
    onDelete,
  } = props;
  const now = useNow();

  const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
  const providerKey = getAuthFileProviderKey(file) || 'unknown';
  const typeLabel = getTypeLabel(t, providerKey);
  const identity = deriveAuthFileIdentity(file);
  const health = getAuthFileHealth(file);
  const problem = describeAuthFileProblem(file, now);
  const refreshKey = getAuthFileRefreshKey(file);
  const isStatusUpdating = statusUpdating[refreshKey] === true;
  const isManualRefreshing = manualRefreshing[refreshKey] === true;
  const authIndexKey = typeof file.authIndex === 'string' ? file.authIndex : null;
  const isCooldownResetting = Boolean(authIndexKey && cooldownResetting[authIndexKey]);
  const quotaType = isRuntimeOnly ? null : resolveAuthFileQuotaType(file, 'all');
  const canRefreshQuota = Boolean(quotaType) && !disableControls && file.disabled !== true;
  const { quota, headline } = useAuthFileQuotaHeadline(file, quotaType);
  // Same lamp as the header counts, filters and pool rail; low quota lives in the quota cell.
  const lamp = getCredentialLampState(file);
  const showModels = !isRuntimeOnly || providerKey === 'aistudio';
  const showManualRefresh = !isRuntimeOnly && supportsAuthFileManualRefresh(providerKey);
  const hasCooldown = Boolean(authIndexKey && file.cooldownSnapshot?.records?.length);
  const lastRefreshMs = readLastRefreshMs(file);
  const lastRefreshText =
    lastRefreshMs !== null
      ? formatRelativeInstant(lastRefreshMs, now, i18n.resolvedLanguage)
      : null;

  const healthLabel = t(`credentials.health_${health}`);

  const problemText = !problem
    ? null
    : problem.kind === 'status'
      ? problem.message || t('credentials.problem_unavailable')
      : formatCooldownLine(t, problem, i18n.resolvedLanguage);

  const handleRowClick = (event: MouseEvent<HTMLLIElement>) => {
    if ((event.target as HTMLElement).closest(ROW_INTERACTIVE_SELECTOR)) return;
    onOpenDetails(file);
  };

  const menuItems: ActionMenuItem[] = [
    {
      id: 'details',
      label: t('credentials.action_details'),
      icon: <IconInfo size={15} />,
      onSelect: () => onOpenDetails(file),
      disabled: disableControls,
    },
  ];
  if (showModels) {
    menuItems.push({
      id: 'models',
      label: t('auth_files.models_button'),
      icon: <IconModelCluster size={15} />,
      onSelect: () => onOpenDetails(file, 'models'),
      disabled: disableControls,
    });
  }
  if (quotaType) {
    menuItems.push({
      id: 'quota',
      label: t('auth_files.quota_refresh_single'),
      icon: <IconRefreshCw size={15} />,
      onSelect: () => onRefreshQuota(file, quotaType),
      disabled: !canRefreshQuota,
    });
  }
  if (showManualRefresh) {
    menuItems.push({
      id: 'token',
      label: t('credentials.action_refresh_token'),
      icon: <IconKey size={15} />,
      onSelect: () => onManualRefresh(file),
      disabled: disableControls || file.disabled === true || isStatusUpdating || isManualRefreshing,
    });
  }
  if (hasCooldown) {
    menuItems.push({
      id: 'cooldown',
      label: t('auth_files.cooldown_reset_button'),
      icon: <IconTimer size={15} />,
      onSelect: () => onCooldownReset(file),
      disabled: disableControls || isStatusUpdating || isManualRefreshing || isCooldownResetting,
    });
  }
  if (!isRuntimeOnly) {
    menuItems.push(
      {
        id: 'download',
        label: t('auth_files.download_button'),
        icon: <IconDownload size={15} />,
        onSelect: () => onDownload(file.name),
        disabled: disableControls,
      },
      { type: 'separator', id: 'sep' },
      {
        id: 'delete',
        label: t('auth_files.delete_button'),
        icon: <IconTrash2 size={15} />,
        danger: true,
        onSelect: () => onDelete(file.name),
        disabled: disableControls || deleting === file.name || isManualRefreshing,
      }
    );
  }

  const rowClasses = [
    styles.row,
    selected ? styles.rowSelected : '',
    file.disabled === true ? styles.rowDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={rowClasses} onClick={handleRowClick} aria-busy={isManualRefreshing || undefined}>
      <div
        className={`${styles.cell} ${styles.cellSelect}`}
        data-visible={selectionMode || undefined}
      >
        {!isRuntimeOnly && (
          <SelectionCheckbox
            checked={selected}
            onChange={() => onToggleSelect(file.name)}
            ariaLabel={t('auth_files.card_select', { name: file.name })}
            title={t('auth_files.card_select', { name: file.name })}
          />
        )}
      </div>
      <div className={`${styles.cell} ${styles.cellLamp}`}>
        <StatusLamp state={lamp} label={healthLabel} live={isManualRefreshing} />
      </div>
      <div className={`${styles.cell} ${styles.cellGlyph}`}>
        <ProviderGlyph provider={providerKey} resolvedTheme={resolvedTheme} />
      </div>
      <div className={`${styles.cell} ${styles.cellAccount}`}>
        <div className={styles.accountLine}>
          <button
            type="button"
            className={`${styles.accountButton} ${identity.kind === 'fileName' ? styles.mono : ''}`}
            onClick={() => onOpenDetails(file)}
            title={identity.fullName}
          >
            {identity.primary || identity.fullName}
          </button>
          {isRuntimeOnly && <span className={styles.badge}>{t('credentials.virtual')}</span>}
        </div>
        <div
          className={`${styles.sub} ${
            problem ? (problem.tone === 'fault' ? styles.subFault : styles.subWarn) : ''
          }`}
          title={problemText ?? identity.fullName}
        >
          {problemText ? (
            <span className={styles.subText}>{problemText}</span>
          ) : (
            <>
              <span className={`${styles.subText} ${styles.subMobile}`}>
                {typeLabel}
                {lastRefreshText ? ` · ${lastRefreshText}` : ''}
              </span>
              {identity.secondary ? (
                <span className={`${styles.subText} ${styles.subDesktop} ${styles.mono}`}>
                  {identity.secondary}
                </span>
              ) : (
                <span className={`${styles.subText} ${styles.subDesktop}`}>{typeLabel}</span>
              )}
            </>
          )}
        </div>
      </div>
      <div className={`${styles.cell} ${styles.cellQuota}`}>
        <AuthFileQuotaCell
          file={file}
          quotaType={quotaType}
          quota={quota}
          headline={headline}
          canRefresh={canRefreshQuota}
          onRefresh={() => quotaType && onRefreshQuota(file, quotaType)}
        />
      </div>
      <div
        className={`${styles.cell} ${styles.cellActivity}`}
        title={t('credentials.activity_title', {
          success: activity.totalSuccess,
          failed: activity.totalFailure,
        })}
      >
        <ActivitySparkline data={activity} max={activityMax} />
        <span className={styles.activityCounts}>
          <span>{activity.totalSuccess}</span>
          <span className={activity.totalFailure > 0 ? styles.countFail : styles.countMuted}>
            / {activity.totalFailure}
          </span>
        </span>
      </div>
      <div className={`${styles.cell} ${styles.cellRefreshed}`}>
        {lastRefreshText ? (
          <time
            dateTime={new Date(lastRefreshMs!).toISOString()}
            title={new Date(lastRefreshMs!).toLocaleString(i18n.resolvedLanguage)}
          >
            {lastRefreshText}
          </time>
        ) : (
          <span className={styles.dash}>—</span>
        )}
      </div>
      <div className={`${styles.cell} ${styles.cellToggle}`}>
        {!isRuntimeOnly && (
          <ToggleSwitch
            ariaLabel={t('auth_files.card_toggle', { name: file.name })}
            checked={!file.disabled}
            disabled={disableControls || isStatusUpdating || isManualRefreshing}
            onChange={(value) => onToggleStatus(file, value)}
          />
        )}
      </div>
      <div className={`${styles.cell} ${styles.cellMenu}`}>
        <ActionMenu
          items={menuItems}
          label={t('credentials.row_actions', { name: identity.primary || file.name })}
          iconOnly
          trigger={<IconMoreHorizontal size={16} />}
          triggerClassName={styles.menuTrigger}
        />
      </div>
    </li>
  );
}

export const AuthFileRow = memo(AuthFileRowView);

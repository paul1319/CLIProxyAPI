import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusLamp } from '@/components/ui/StatusLamp';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconCopy } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { AuthFileItem } from '@/types';
import { formatFileSize } from '@/utils/format';
import { formatRelativeInstant } from '@/utils/quota';
import type { StatusBarData } from '@/utils/recentRequests';
import {
  formatModified,
  getAuthFileStatusMessage,
  getTypeLabel,
  hasAuthFileStatusWarning,
  isRuntimeOnlyAuthFile,
  type AuthFileModelItem,
} from '@/features/authFiles/constants';
import {
  getAuthFileHealth,
  getAuthFileProviderKey,
  lampForHealth,
  resolveAuthFileQuotaType,
} from '@/features/authFiles/logic';
import { getAuthFileRefreshKey } from '@/features/authFiles/manualRefresh';
import { readLastRefreshMs } from '@/features/authFiles/rowModel';
import { ActivitySparkline } from './ActivitySparkline';
import { AuthFileCooldownSection } from './AuthFileCooldownSection';
import { AuthFileModelsList } from './AuthFileModelsList';
import { AuthFileQuotaSection } from './AuthFileQuotaSection';
import styles from './AuthFileDetailsSheet.module.scss';

export type AuthFileOverviewProps = {
  file: AuthFileItem;
  disableControls: boolean;
  statusUpdating: Record<string, boolean>;
  manualRefreshing: Record<string, boolean>;
  cooldownResetting: Record<string, boolean>;
  activity: StatusBarData;
  models: {
    loading: boolean;
    error: 'unsupported' | null;
    list: AuthFileModelItem[];
    excludedRules: readonly string[];
  };
  /** Scroll the models section into view once (row menu → "Models"). */
  focusModels: boolean;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onCooldownReset: (file: AuthFileItem) => void;
  onCopyText: (text: string) => void;
};

function Section({
  title,
  aside,
  children,
  sectionRef,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  sectionRef?: React.Ref<HTMLElement>;
}) {
  return (
    <section className={styles.section} ref={sectionRef}>
      <header className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function AuthFileOverview(props: AuthFileOverviewProps) {
  const { t, i18n } = useTranslation();
  const {
    file,
    disableControls,
    statusUpdating,
    manualRefreshing,
    cooldownResetting,
    activity,
    models,
    focusModels,
    onToggleStatus,
    onCooldownReset,
    onCopyText,
  } = props;
  const now = useNow();
  const modelsRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!focusModels) return;
    const timer = window.setTimeout(
      () => modelsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      320
    );
    return () => window.clearTimeout(timer);
  }, [focusModels]);

  const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
  const providerKey = getAuthFileProviderKey(file) || 'unknown';
  const health = getAuthFileHealth(file);
  const refreshKey = getAuthFileRefreshKey(file);
  const isStatusUpdating = statusUpdating[refreshKey] === true;
  const isManualRefreshing = manualRefreshing[refreshKey] === true;
  const authIndexKey = typeof file.authIndex === 'string' ? file.authIndex : null;
  const quotaType = isRuntimeOnly ? null : resolveAuthFileQuotaType(file, 'all');
  const statusMessage = hasAuthFileStatusWarning(file) ? getAuthFileStatusMessage(file) : '';
  const showModels = !isRuntimeOnly || providerKey === 'aistudio';
  const lastRefreshMs = readLastRefreshMs(file);

  const identityRows: Array<{ label: string; value: ReactNode; copy?: string }> = [];
  const push = (label: string, value: unknown, options?: { mono?: boolean; copy?: boolean }) => {
    if (value === undefined || value === null || value === '') return;
    const text = String(value);
    identityRows.push({
      label,
      value: options?.mono ? <span className={styles.mono}>{text}</span> : text,
      copy: options?.copy ? text : undefined,
    });
  };
  // Never surface `account`: for api-key credentials it is the key itself.
  push(t('credentials.field_email'), file.email);
  push(t('credentials.field_file'), file.name, { mono: true, copy: true });
  push(t('credentials.field_provider'), getTypeLabel(t, providerKey));
  push(t('credentials.field_project'), file.projectId, { mono: true });
  push(t('credentials.field_auth_index'), file.authIndex ?? undefined, { mono: true });
  push(
    t('auth_files.priority_display'),
    Number.isSafeInteger(file.priority) ? file.priority : undefined
  );
  push(t('auth_files.weight_display'), Number.isSafeInteger(file.weight) ? file.weight : undefined);
  push(t('auth_files.note_label'), typeof file.note === 'string' ? file.note.trim() : undefined);
  push(
    t('credentials.field_last_refresh'),
    lastRefreshMs !== null
      ? `${formatRelativeInstant(lastRefreshMs, now, i18n.resolvedLanguage)} · ${new Date(
          lastRefreshMs
        ).toLocaleString(i18n.resolvedLanguage)}`
      : undefined
  );
  const modified = formatModified(file);
  push(t('auth_files.file_modified'), modified !== '-' ? modified : undefined);
  push(t('auth_files.file_size'), file.size ? formatFileSize(file.size) : undefined);

  const totalSuccess = file.successCount ?? 0;
  const totalFailure = file.failureCount ?? 0;

  return (
    <div className={styles.overview}>
      <div className={`${styles.statusPanel} ${styles[`status_${health}`] ?? ''}`}>
        <div className={styles.statusLine}>
          <StatusLamp state={lampForHealth(health)} live={isManualRefreshing} />
          <span className={styles.statusLabel}>{t(`credentials.health_${health}`)}</span>
          {isRuntimeOnly && <span className={styles.badge}>{t('credentials.virtual')}</span>}
          {!isRuntimeOnly && (
            <span className={styles.statusToggle}>
              <ToggleSwitch
                label={t('auth_files.status_toggle_label')}
                labelPosition="left"
                ariaLabel={t('auth_files.card_toggle', { name: file.name })}
                checked={!file.disabled}
                disabled={disableControls || isStatusUpdating || isManualRefreshing}
                onChange={(value) => onToggleStatus(file, value)}
              />
            </span>
          )}
        </div>
        {statusMessage && <p className={styles.statusMessage}>{statusMessage}</p>}
      </div>

      <AuthFileCooldownSection
        snapshot={file.cooldownSnapshot}
        defaultOpen
        resetting={Boolean(authIndexKey && cooldownResetting[authIndexKey])}
        resetDisabled={disableControls || isStatusUpdating || isManualRefreshing}
        onReset={authIndexKey ? () => onCooldownReset(file) : undefined}
      />

      {quotaType && (
        <Section title={t('credentials.section_quota')}>
          <AuthFileQuotaSection
            file={file}
            quotaType={quotaType}
            disableControls={disableControls}
            autoRefresh={false}
          />
        </Section>
      )}

      <Section
        title={t('credentials.section_activity')}
        aside={
          <span className={styles.sectionAside}>
            {t('credentials.activity_window', {
              success: activity.totalSuccess,
              failed: activity.totalFailure,
            })}
          </span>
        }
      >
        <div className={styles.activityChart}>
          <ActivitySparkline
            data={activity}
            max={Math.max(
              1,
              ...activity.blockDetails.map((block) => block.success + block.failure)
            )}
            barWidth={14}
            height={44}
            fluid
          />
        </div>
        <p className={styles.mutedNote}>
          {t('credentials.activity_total', { success: totalSuccess, failed: totalFailure })}
        </p>
      </Section>

      <Section title={t('credentials.section_identity')}>
        <dl className={styles.facts}>
          {identityRows.map((row) => (
            <div key={row.label} className={styles.fact}>
              <dt>{row.label}</dt>
              <dd>
                <span className={styles.factValue}>{row.value}</span>
                {row.copy && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => onCopyText(row.copy!)}
                    title={t('common.copy')}
                    aria-label={`${t('common.copy')} ${row.label}`}
                  >
                    <IconCopy size={13} />
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      {showModels && (
        <Section
          title={t('auth_files.models_title')}
          sectionRef={modelsRef}
          aside={
            !models.loading && models.list.length > 0 ? (
              <span className={styles.sectionAside}>{models.list.length}</span>
            ) : undefined
          }
        >
          <AuthFileModelsList
            loading={models.loading}
            error={models.error}
            models={models.list}
            excludedRules={models.excludedRules}
            onCopyText={onCopyText}
          />
        </Section>
      )}
    </div>
  );
}

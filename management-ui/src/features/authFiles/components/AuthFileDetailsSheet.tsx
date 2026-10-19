import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusLamp } from '@/components/ui/StatusLamp';
import { IconCopy } from '@/components/ui/icons';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import type { StatusBarData } from '@/utils/recentRequests';
import type {
  PrefixProxyEditorField,
  PrefixProxyEditorFieldValue,
  PrefixProxyEditorState,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import {
  getTypeLabel,
  type AuthFileModelItem,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import {
  getAuthFileHealth,
  getAuthFileProviderKey,
  lampForHealth,
} from '@/features/authFiles/logic';
import { credentialPolicyError } from '../credentialPolicy';
import { AuthFileOverview } from './AuthFileOverview';
import { AuthFileSettingsForm } from './AuthFileSettingsForm';
import { ProviderGlyph } from './ProviderGlyph';
import { UnderlineTabs } from './UnderlineTabs';
import { tabId, tabPanelId } from './underlineTabIds';
import styles from './AuthFileDetailsSheet.module.scss';

/** Fields the API boundary derives; the raw metadata view shows only the backend's own shape. */
const DERIVED_INFO_KEYS = [
  'successCount',
  'failureCount',
  'recentRequests',
  'runtimeOnly',
  'authIndex',
  'statusMessage',
  'modified',
  // 'email' is deliberately kept: backend and camelCase keys coincide, removing it would hide data.
  'projectId',
];

/** `account` is the API key itself for api-key credentials; never echo it from list metadata. */
const HIDDEN_INFO_KEYS = ['account'];

export type AuthFileDetailsTab = 'overview' | 'settings' | 'raw';

export type AuthFileDetailsSheetProps = {
  /** Live list entry for the open credential (keeps Overview in sync with polling). */
  file: AuthFileItem | null;
  initialSection: 'overview' | 'models';
  resolvedTheme: ResolvedTheme;
  disableControls: boolean;
  editor: PrefixProxyEditorState | null;
  updatedText: string;
  dirty: boolean;
  statusUpdating: Record<string, boolean>;
  manualRefreshing: Record<string, boolean>;
  cooldownResetting: Record<string, boolean>;
  activity: StatusBarData | null;
  models: {
    loading: boolean;
    error: 'unsupported' | null;
    list: AuthFileModelItem[];
    excludedRules: readonly string[];
  };
  onClose: () => void;
  onCopyText: (text: string) => void | Promise<void>;
  onSave: () => void;
  onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onCooldownReset: (file: AuthFileItem) => void;
};

const formatJsonText = (text: string) => {
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

/**
 * Credential details: Overview (state, quota, activity, identity, models) · Settings
 * (editable fields, saved only when dirty) · Raw JSON. Closing with unsaved edits confirms first.
 */
export function AuthFileDetailsSheet(props: AuthFileDetailsSheetProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    file,
    initialSection,
    resolvedTheme,
    disableControls,
    editor,
    updatedText,
    dirty,
    statusUpdating,
    manualRefreshing,
    cooldownResetting,
    activity,
    models,
    onClose,
    onCopyText,
    onSave,
    onChange,
    onToggleStatus,
    onCooldownReset,
  } = props;
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [tab, setTab] = useState<AuthFileDetailsTab>('overview');
  const fileName = editor?.fileName ?? '';

  // Every newly opened credential starts on Overview.
  useEffect(() => {
    setTab('overview');
  }, [fileName]);

  const confirmClose = useCallback((): boolean | Promise<boolean> => {
    if (!dirty || editor?.saving === true) return true;
    return new Promise<boolean>((resolve) => {
      showConfirmation({
        title: t('providersPage.unsavedChanges.title'),
        message: t('providersPage.unsavedChanges.message'),
        variant: 'danger',
        confirmText: t('providersPage.unsavedChanges.discard'),
        cancelText: t('providersPage.unsavedChanges.keepEditing'),
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, [dirty, editor?.saving, showConfirmation, t]);

  const handleCancelClick = useCallback(() => {
    void Promise.resolve(confirmClose()).then((ok) => {
      if (ok) onClose();
    });
  }, [confirmClose, onClose]);

  const handleSettingsLinkClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (editor?.saving) return;

      void Promise.resolve(confirmClose()).then((ok) => {
        if (ok) void navigate('/config?field=routingStrategy');
      });
    },
    [confirmClose, editor?.saving, navigate]
  );

  const previewText = formatJsonText(updatedText);
  const fileInfoText = editor?.fileInfoText ?? '';
  const displayInfoText = useMemo(() => {
    if (!fileInfoText) return '';
    try {
      const parsed = JSON.parse(fileInfoText) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        [...DERIVED_INFO_KEYS, ...HIDDEN_INFO_KEYS].forEach((key) => {
          delete record[key];
        });
        return JSON.stringify(record, null, 2);
      }
    } catch {
      /* Non-JSON content is shown verbatim. */
    }
    return fileInfoText;
  }, [fileInfoText]);

  const identity = file ? deriveAuthFileIdentity(file) : null;
  const providerKey = file ? getAuthFileProviderKey(file) || 'unknown' : '';
  const health = file ? getAuthFileHealth(file) : null;
  const saveDisabled =
    disableControls ||
    editor?.saving === true ||
    !dirty ||
    !editor?.json ||
    Boolean(editor?.headersTouched && editor.headersError) ||
    Boolean(editor?.weightError) ||
    Boolean(credentialPolicyError(editor?.policy));
  const showSaveFooter = tab === 'settings' || dirty;

  const editorBody = (render: (json: Record<string, unknown>) => React.ReactNode) => {
    if (!editor || editor.loading) {
      return (
        <div className={styles.loadingBlock} aria-busy="true">
          <span className={styles.srOnly}>{t('auth_files.prefix_proxy_loading')}</span>
          {[40, 100, 70, 100, 55].map((width, index) => (
            <Skeleton key={index} width={`${width}%`} height={index % 2 ? 32 : 10} rounded={6} />
          ))}
        </div>
      );
    }
    if (!editor.json) {
      return (
        <div className={styles.rawBlock}>
          {editor.error && (
            <p className={styles.inlineError} role="alert">
              {editor.error}
            </p>
          )}
          {editor.invalidContentPreview && (
            <>
              <h3 className={styles.sectionTitle}>
                {t('auth_files.prefix_proxy_invalid_content_label')}
              </h3>
              <pre className={styles.code}>{editor.invalidContentPreview}</pre>
            </>
          )}
        </div>
      );
    }
    return render(editor.json);
  };

  return (
    <Sheet
      open={Boolean(editor)}
      onClose={onClose}
      confirmClose={confirmClose}
      size="lg"
      closeDisabled={editor?.saving === true}
      eyebrow={
        file ? (
          <span className={styles.eyebrow}>
            <ProviderGlyph provider={providerKey} resolvedTheme={resolvedTheme} size="sm" />
            {getTypeLabel(t, providerKey)}
          </span>
        ) : undefined
      }
      title={identity?.primary || fileName}
      description={
        file && health ? (
          <span className={styles.headerMeta}>
            <StatusLamp state={lampForHealth(health)} size={6} />
            <span>{t(`credentials.health_${health}`)}</span>
            {identity?.secondary && (
              <>
                <span className={styles.dot} aria-hidden="true">
                  ·
                </span>
                <span className={styles.mono}>{file.name}</span>
              </>
            )}
          </span>
        ) : undefined
      }
      footer={
        showSaveFooter ? (
          <>
            {dirty && <span className={styles.dirtyNote}>{t('credentials.unsaved_changes')}</span>}
            <Button
              variant="secondary"
              onClick={handleCancelClick}
              disabled={editor?.saving === true}
            >
              {dirty ? t('common.cancel') : t('common.close')}
            </Button>
            <Button onClick={onSave} loading={editor?.saving === true} disabled={saveDisabled}>
              {t('common.save')}
            </Button>
          </>
        ) : undefined
      }
    >
      <UnderlineTabs
        className={styles.tabs}
        idPrefix="auth-file-details"
        label={t('credentials.details_tabs')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: t('credentials.tab_overview') },
          { id: 'settings', label: t('credentials.tab_settings') },
          { id: 'raw', label: t('credentials.tab_raw') },
        ]}
      />
      <div
        role="tabpanel"
        id={tabPanelId('auth-file-details', tab)}
        aria-labelledby={tabId('auth-file-details', tab)}
        className={styles.panel}
      >
        {tab === 'overview' && file && activity && (
          <AuthFileOverview
            file={file}
            disableControls={disableControls}
            statusUpdating={statusUpdating}
            manualRefreshing={manualRefreshing}
            cooldownResetting={cooldownResetting}
            activity={activity}
            models={models}
            focusModels={initialSection === 'models'}
            onToggleStatus={onToggleStatus}
            onCooldownReset={onCooldownReset}
            onCopyText={(text) => void onCopyText(text)}
          />
        )}
        {tab === 'overview' && !file && editor && (
          <p className={styles.mutedNote}>{t('credentials.details_missing')}</p>
        )}
        {tab === 'settings' &&
          editorBody((json) => (
            <>
              {editor?.error && (
                <p className={styles.inlineError} role="alert">
                  {editor.error}
                </p>
              )}
              <AuthFileSettingsForm
                editor={{ ...editor!, json }}
                disableControls={disableControls}
                onChange={onChange}
                onSettingsLinkClick={handleSettingsLinkClick}
              />
            </>
          ))}
        {tab === 'raw' &&
          editorBody(() => (
            <div className={styles.rawBlock}>
              <div className={styles.sectionHead}>
                <h3 className={styles.sectionTitle}>{t('auth_files.prefix_proxy_source_label')}</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (!updatedText) return;
                    void onCopyText(updatedText);
                  }}
                  disabled={!updatedText}
                >
                  <IconCopy size={14} />
                  {t('common.copy')}
                </Button>
              </div>
              {dirty && <p className={styles.mutedNote}>{t('credentials.raw_preview_note')}</p>}
              <pre className={styles.code}>{previewText}</pre>
              {displayInfoText && (
                <Collapsible label={t('credentials.list_metadata')}>
                  <pre className={styles.code}>{displayInfoText}</pre>
                </Collapsible>
              )}
            </div>
          ))}
      </div>
    </Sheet>
  );
}

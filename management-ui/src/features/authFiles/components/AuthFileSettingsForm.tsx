import { useId, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type {
  PrefixProxyEditorField,
  PrefixProxyEditorFieldValue,
  PrefixProxyEditorState,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import {
  supportsAuthFileUsingApi,
  supportsAuthFileWebsockets,
} from '@/features/authFiles/constants';
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import { AuthFileExcludedModelsField } from './AuthFileExcludedModelsField';
import { AuthFilePolicyFields } from './AuthFilePolicyFields';
import { readCredentialPolicy } from '../credentialPolicy';
import styles from './AuthFileDetailsSheet.module.scss';

export type AuthFileSettingsFormProps = {
  editor: PrefixProxyEditorState & { json: Record<string, unknown> };
  disableControls: boolean;
  onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void;
  onSettingsLinkClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupTitle}>{title}</legend>
      <div className={styles.groupBody}>{children}</div>
    </fieldset>
  );
}

function SwitchField({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className={styles.switchField}>
      <div className={styles.switchCopy}>
        <label htmlFor={id} className={styles.switchLabel}>
          {label}
        </label>
        <p id={`${id}-hint`} className={styles.switchHint}>
          {hint}
        </p>
      </div>
      <ToggleSwitch
        id={id}
        ariaDescribedBy={`${id}-hint`}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

/** Editable credential fields grouped by concern: General · Routing · Network · Models · Policy. */
export function AuthFileSettingsForm({
  editor,
  disableControls,
  onChange,
  onSettingsLinkClick,
}: AuthFileSettingsFormProps) {
  const { t } = useTranslation();
  const disabled = disableControls || editor.saving;
  const headersId = useId();

  return (
    <div className={styles.settings}>
      <Group title={t('credentials.group_general')}>
        <Input
          label={t('auth_files.note_label')}
          value={editor.note}
          placeholder={t('auth_files.note_placeholder')}
          hint={t('auth_files.note_hint')}
          disabled={disabled}
          onChange={(e) => onChange('note', e.target.value)}
        />
      </Group>

      <Group title={t('credentials.group_routing')}>
        <div className={styles.fieldPair}>
          <Input
            label={t('auth_files.priority_label')}
            value={editor.priority}
            placeholder={t('auth_files.priority_placeholder')}
            hint={t('auth_files.priority_hint')}
            disabled={disabled}
            onChange={(e) => onChange('priority', e.target.value)}
          />
          <Input
            label={t('auth_files.weight_label')}
            type="number"
            step="1"
            max={MAX_CREDENTIAL_WEIGHT}
            value={editor.weight}
            placeholder="1"
            hint={
              <Trans
                i18nKey="auth_files.weight_hint"
                components={{
                  settingsLink: (
                    <Link
                      className={styles.settingsLink}
                      to="/config?field=routingStrategy"
                      onClick={onSettingsLinkClick}
                    />
                  ),
                }}
              />
            }
            error={editor.weightError ?? undefined}
            disabled={disabled}
            onChange={(e) => onChange('weight', e.target.value)}
          />
        </div>
        <Input
          label={t('auth_files.prefix_label')}
          value={editor.prefix}
          disabled={disabled}
          onChange={(e) => onChange('prefix', e.target.value)}
        />
        <SwitchField
          label={t('auth_files.disable_cooling_label')}
          hint={t('auth_files.disable_cooling_hint')}
          checked={editor.disableCooling}
          disabled={disabled}
          onChange={(value) => onChange('disableCooling', value)}
        />
      </Group>

      <Group title={t('credentials.group_network')}>
        <Input
          label={t('auth_files.proxy_url_label')}
          value={editor.proxyUrl}
          placeholder={t('auth_files.proxy_url_placeholder')}
          disabled={disabled}
          onChange={(e) => onChange('proxyUrl', e.target.value)}
        />
        <div className="form-group">
          <label htmlFor={headersId}>{t('auth_files.headers_label')}</label>
          <textarea
            id={headersId}
            className={`input ${styles.codeInput} ${editor.headersError ? styles.textareaInvalid : ''}`}
            value={editor.headersText}
            placeholder={t('auth_files.headers_placeholder')}
            rows={4}
            spellCheck={false}
            aria-invalid={Boolean(editor.headersError)}
            disabled={disabled}
            onChange={(e) => onChange('headersText', e.target.value)}
          />
          {editor.headersError && <div className="error-box">{editor.headersError}</div>}
          <div className="hint">{t('auth_files.headers_hint')}</div>
        </div>
        {supportsAuthFileWebsockets(editor.providerKey) && (
          <SwitchField
            label={t('auth_files.websockets_label')}
            hint={t('auth_files.websockets_hint')}
            checked={editor.websockets}
            disabled={disabled}
            onChange={(value) => onChange('websockets', value)}
          />
        )}
        {supportsAuthFileUsingApi(editor.providerKey) && (
          <SwitchField
            label={t('auth_files.using_api_label')}
            hint={t('auth_files.using_api_hint')}
            checked={editor.usingApi}
            disabled={disabled}
            onChange={(value) => onChange('usingApi', value)}
          />
        )}
      </Group>

      <Group title={t('credentials.group_models')}>
        <AuthFileExcludedModelsField
          fileName={editor.fileName}
          value={editor.excludedModelsText}
          disabled={disabled}
          onChange={(value) => onChange('excludedModelsText', value)}
        />
      </Group>

      <Group title={t('credentials.group_policy')}>
        <AuthFilePolicyFields
          draft={editor.policy ?? readCredentialPolicy(editor.json)}
          disabled={disabled}
          onChange={onChange}
        />
      </Group>
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import type { ConfigSectionProps } from '../../types';
import { ApiKeysCardEditor } from '../blocks/ApiKeysCardEditor';
import { StringListEditor } from '../blocks/StringListEditor';
import { getValidationMessage } from '../blocks/shared';
import { BlockSetting, SettingGroup, TextSetting, ToggleSetting } from '../fields/FieldPrimitives';
import { SectionDiscovery } from './SectionDiscovery';

/** Server & access: listen address, client API keys, TLS, remote management and LAN discovery. */
export function SectionConnectivity({
  values,
  validationErrors,
  disabled,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <SettingGroup group="server">
        <TextSetting
          fieldId="host"
          label={t('config_management.visual.sections.server.host')}
          placeholder="0.0.0.0"
          value={values.host}
          onChange={(host) => onChange({ host })}
          disabled={disabled}
        />
        <TextSetting
          fieldId="port"
          size="sm"
          label={t('config_management.visual.sections.server.port')}
          type="number"
          placeholder="8317"
          value={values.port}
          onChange={(port) => onChange({ port })}
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.port)}
        />
        <TextSetting
          fieldId="authDir"
          size="lg"
          label={t('config_management.visual.sections.auth.auth_dir')}
          description={t('config_management.visual.sections.auth.auth_dir_hint')}
          placeholder="~/.cli-proxy-api"
          value={values.authDir}
          onChange={(authDir) => onChange({ authDir })}
          disabled={disabled}
        />
        <TextSetting
          fieldId="githubToken"
          label={t('config_management.visual.sections.server.github_token')}
          description={t('config_management.visual.sections.server.github_token_hint')}
          type="password"
          autoComplete="new-password"
          value={values.githubToken}
          onChange={(githubToken) => onChange({ githubToken })}
          disabled={disabled}
        />
        <BlockSetting
          fieldId="trustedProxies"
          label={t('config_management.visual.serverExtras.trustedProxies.label')}
          description={t('config_management.visual.serverExtras.trustedProxies.hint')}
          error={getValidationMessage(t, validationErrors?.trustedProxies)}
        >
          <StringListEditor
            value={values.trustedProxies}
            disabled={disabled}
            placeholder="192.168.0.0/24"
            inputAriaLabel={t('config_management.visual.serverExtras.trustedProxies.label')}
            onChange={(trustedProxies) => onChange({ trustedProxies })}
          />
        </BlockSetting>
      </SettingGroup>

      <ApiKeysCardEditor
        group="apiKeys"
        fieldId="apiKeys"
        value={values.apiKeysText}
        disabled={disabled}
        onChange={(apiKeysText) => onChange({ apiKeysText })}
      />

      <SettingGroup
        group="tls"
        description={t('config_management.visual.sections.tls.description')}
      >
        <ToggleSetting
          fieldId="tlsEnable"
          label={t('config_management.visual.sections.tls.enable')}
          description={t('config_management.visual.sections.tls.enable_desc')}
          checked={values.tlsEnable}
          disabled={disabled}
          onChange={(tlsEnable) => onChange({ tlsEnable })}
        />
        {values.tlsEnable ? (
          <>
            <TextSetting
              fieldId="tlsCert"
              size="lg"
              label={t('config_management.visual.sections.tls.cert')}
              placeholder="/path/to/cert.pem"
              value={values.tlsCert}
              onChange={(tlsCert) => onChange({ tlsCert })}
              disabled={disabled}
            />
            <TextSetting
              fieldId="tlsKey"
              size="lg"
              label={t('config_management.visual.sections.tls.key')}
              placeholder="/path/to/key.pem"
              value={values.tlsKey}
              onChange={(tlsKey) => onChange({ tlsKey })}
              disabled={disabled}
            />
          </>
        ) : null}
      </SettingGroup>

      <SettingGroup
        group="remote"
        description={t('config_management.visual.sections.remote.description')}
      >
        <ToggleSetting
          fieldId="rmAllowRemote"
          label={t('config_management.visual.sections.remote.allow_remote')}
          description={t('config_management.visual.sections.remote.allow_remote_desc')}
          checked={values.rmAllowRemote}
          disabled={disabled}
          onChange={(rmAllowRemote) => onChange({ rmAllowRemote })}
        />
        <ToggleSetting
          fieldId="rmDisableControlPanel"
          label={t('config_management.visual.sections.remote.disable_panel')}
          description={t('config_management.visual.sections.remote.disable_panel_desc')}
          checked={values.rmDisableControlPanel}
          disabled={disabled}
          onChange={(rmDisableControlPanel) => onChange({ rmDisableControlPanel })}
        />
        <ToggleSetting
          fieldId="rmDisableAutoUpdatePanel"
          label={t('config_management.visual.sections.remote.disable_auto_update_panel')}
          description={t('config_management.visual.sections.remote.disable_auto_update_panel_desc')}
          checked={values.rmDisableAutoUpdatePanel}
          disabled={disabled}
          onChange={(rmDisableAutoUpdatePanel) => onChange({ rmDisableAutoUpdatePanel })}
        />
        <TextSetting
          fieldId="rmSecretKey"
          label={t('config_management.visual.sections.remote.secret_key')}
          type="password"
          autoComplete="new-password"
          placeholder={t('config_management.visual.sections.remote.secret_key_placeholder')}
          value={values.rmSecretKey}
          onChange={(rmSecretKey) => onChange({ rmSecretKey })}
          disabled={disabled}
        />
        <TextSetting
          fieldId="rmPanelRepo"
          size="lg"
          label={t('config_management.visual.sections.remote.panel_repo')}
          placeholder="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
          value={values.rmPanelRepo}
          onChange={(rmPanelRepo) => onChange({ rmPanelRepo })}
          disabled={disabled}
        />
      </SettingGroup>

      <SectionDiscovery
        values={values}
        validationErrors={validationErrors}
        disabled={disabled}
        onChange={onChange}
      />
    </>
  );
}

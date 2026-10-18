import { useTranslation } from 'react-i18next';
import type { ConfigSectionProps } from '../../types';
import { CodexLiveICEServersEditor } from '../blocks/CodexLiveICEServersEditor';
import { getValidationMessage } from '../blocks/shared';
import {
  BlockSetting,
  SectionNote,
  SettingGroup,
  TextSetting,
  ToggleSetting,
} from '../fields/FieldPrimitives';
import { SectionProviders } from './SectionProviders';

/**
 * Providers & advanced: per-provider OAuth behavior and header defaults (Claude, Codex, live
 * relay), then Antigravity, Devin, xAI and plugins (SectionProviders).
 */
export function SectionAdvanced({
  values,
  validationErrors,
  disabled,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <SectionNote>{t('config_management.visual.additions.oauthHint')}</SectionNote>

      <SettingGroup group="claude">
        <ToggleSetting
          fieldId="claudeModelLevelCooling"
          label={t('config_management.visual.additions.claudeModelLevelCooling.label')}
          description={t('config_management.visual.additions.claudeModelLevelCooling.hint')}
          checked={values.claudeModelLevelCooling}
          disabled={disabled}
          onChange={(claudeModelLevelCooling) => onChange({ claudeModelLevelCooling })}
        />
        <ToggleSetting
          fieldId="claudeDisableCloakMode"
          label={t('config_management.visual.additions.claudeDisableCloakMode.label')}
          description={t('config_management.visual.additions.claudeDisableCloakMode.hint')}
          checked={values.claudeDisableCloakMode}
          disabled={disabled}
          onChange={(claudeDisableCloakMode) => onChange({ claudeDisableCloakMode })}
        />
        <ToggleSetting
          fieldId="claudeCodeDisableCloakingModelList"
          label={t('config_management.visual.additions.claudeCodeDisableCloakingModelList.label')}
          description={t(
            'config_management.visual.additions.claudeCodeDisableCloakingModelList.hint'
          )}
          checked={values.claudeCodeDisableCloakingModelList}
          disabled={disabled}
          onChange={(claudeCodeDisableCloakingModelList) =>
            onChange({ claudeCodeDisableCloakingModelList })
          }
        />
      </SettingGroup>

      <SettingGroup
        group="claudeHeaders"
        description={t('config_management.visual.sections.headers.description')}
      >
        <TextSetting
          fieldId="claudeHeaderUserAgent"
          size="lg"
          label={t('config_management.visual.sections.headers.user_agent')}
          placeholder="claude-cli/2.1.44 (external, sdk-cli)"
          value={values.claudeHeaderUserAgent}
          onChange={(claudeHeaderUserAgent) => onChange({ claudeHeaderUserAgent })}
          disabled={disabled}
        />
        <TextSetting
          fieldId="claudeHeaderPackageVersion"
          size="sm"
          label={t('config_management.visual.sections.headers.package_version')}
          placeholder="0.74.0"
          value={values.claudeHeaderPackageVersion}
          onChange={(claudeHeaderPackageVersion) => onChange({ claudeHeaderPackageVersion })}
          disabled={disabled}
        />
        <TextSetting
          fieldId="claudeHeaderRuntimeVersion"
          size="sm"
          label={t('config_management.visual.sections.headers.runtime_version')}
          placeholder="v24.3.0"
          value={values.claudeHeaderRuntimeVersion}
          onChange={(claudeHeaderRuntimeVersion) => onChange({ claudeHeaderRuntimeVersion })}
          disabled={disabled}
        />
        <TextSetting
          fieldId="claudeHeaderOs"
          size="sm"
          label={t('config_management.visual.sections.headers.os')}
          placeholder="MacOS"
          value={values.claudeHeaderOs}
          onChange={(claudeHeaderOs) => onChange({ claudeHeaderOs })}
          disabled={disabled}
        />
        <TextSetting
          fieldId="claudeHeaderArch"
          size="sm"
          label={t('config_management.visual.sections.headers.arch')}
          placeholder="arm64"
          value={values.claudeHeaderArch}
          onChange={(claudeHeaderArch) => onChange({ claudeHeaderArch })}
          disabled={disabled}
        />
        <TextSetting
          fieldId="claudeHeaderTimezone"
          label={t('config_management.visual.additions.claudeHeaderTimezone.label')}
          description={t('config_management.visual.additions.claudeHeaderTimezone.hint')}
          value={values.claudeHeaderTimezone}
          onChange={(claudeHeaderTimezone) => onChange({ claudeHeaderTimezone })}
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.claudeHeaderTimezone)}
        />
        <TextSetting
          fieldId="claudeHeaderTimeout"
          size="sm"
          label={t('config_management.visual.sections.headers.timeout')}
          placeholder="600"
          value={values.claudeHeaderTimeout}
          onChange={(claudeHeaderTimeout) => onChange({ claudeHeaderTimeout })}
          disabled={disabled}
        />
        <ToggleSetting
          fieldId="claudeHeaderStabilizeDeviceProfile"
          label={t('config_management.visual.sections.headers.stabilize_device')}
          description={t('config_management.visual.sections.headers.stabilize_device_desc')}
          checked={values.claudeHeaderStabilizeDeviceProfile}
          disabled={disabled}
          onChange={(claudeHeaderStabilizeDeviceProfile) =>
            onChange({ claudeHeaderStabilizeDeviceProfile })
          }
        />
      </SettingGroup>

      <SettingGroup group="codex">
        <ToggleSetting
          fieldId="codexDisableCloaking"
          label={t('config_management.visual.additions.codexDisableCloaking.label')}
          description={t('config_management.visual.additions.codexDisableCloaking.hint')}
          checked={values.codexDisableCloaking}
          disabled={disabled}
          onChange={(codexDisableCloaking) => onChange({ codexDisableCloaking })}
        />
        <ToggleSetting
          fieldId="codexModelLevelCooling"
          label={t('config_management.visual.additions.codexModelLevelCooling.label')}
          description={t('config_management.visual.additions.codexModelLevelCooling.hint')}
          checked={values.codexModelLevelCooling}
          disabled={disabled}
          onChange={(codexModelLevelCooling) => onChange({ codexModelLevelCooling })}
        />
        <ToggleSetting
          fieldId="codexStreamBootstrapBuffering"
          label={t('config_management.visual.additions.codexStreamBootstrapBuffering.label')}
          description={t('config_management.visual.additions.codexStreamBootstrapBuffering.hint')}
          checked={values.codexStreamBootstrapBuffering}
          disabled={disabled}
          onChange={(codexStreamBootstrapBuffering) => onChange({ codexStreamBootstrapBuffering })}
        />
        <TextSetting
          fieldId="codexStreamBootstrapTimeout"
          size="sm"
          label={t('config_management.visual.additions.codexStreamBootstrapTimeout.label')}
          description={t('config_management.visual.additions.codexStreamBootstrapTimeout.hint')}
          value={values.codexStreamBootstrapTimeout}
          onChange={(codexStreamBootstrapTimeout) => onChange({ codexStreamBootstrapTimeout })}
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.codexStreamBootstrapTimeout)}
        />
        <ToggleSetting
          fieldId="codexOptimizeMultiAgentV2"
          label={t('config_management.visual.additions.codexOptimizeMultiAgentV2.label')}
          description={t('config_management.visual.additions.codexOptimizeMultiAgentV2.hint')}
          checked={values.codexOptimizeMultiAgentV2}
          disabled={disabled}
          onChange={(codexOptimizeMultiAgentV2) => onChange({ codexOptimizeMultiAgentV2 })}
        />
        <ToggleSetting
          fieldId="codexOrphanDelegationCompatibility"
          label={t('config_management.visual.additions.codexOrphanDelegationCompatibility.label')}
          description={t(
            'config_management.visual.additions.codexOrphanDelegationCompatibility.hint'
          )}
          checked={values.codexOrphanDelegationCompatibility}
          disabled={disabled}
          onChange={(codexOrphanDelegationCompatibility) =>
            onChange({ codexOrphanDelegationCompatibility })
          }
        />
        <ToggleSetting
          fieldId="codexResponseSteering"
          label={t('config_management.visual.additions.codexResponseSteering.label')}
          description={t('config_management.visual.additions.codexResponseSteering.hint')}
          checked={values.codexResponseSteering}
          disabled={disabled}
          onChange={(codexResponseSteering) => onChange({ codexResponseSteering })}
        />
      </SettingGroup>

      <SettingGroup
        group="codexHeaders"
        description={t('config_management.visual.sections.headers.description')}
      >
        <TextSetting
          fieldId="codexHeaderUserAgent"
          size="lg"
          label={t('config_management.visual.sections.headers.user_agent')}
          placeholder="codex_cli_rs/0.114.0 (Mac OS 14.2.0; x86_64) vscode/1.111.0"
          value={values.codexHeaderUserAgent}
          onChange={(codexHeaderUserAgent) => onChange({ codexHeaderUserAgent })}
          disabled={disabled}
        />
        <TextSetting
          fieldId="codexHeaderBetaFeatures"
          label={t('config_management.visual.sections.headers.beta_features')}
          placeholder="multi_agent"
          value={values.codexHeaderBetaFeatures}
          onChange={(codexHeaderBetaFeatures) => onChange({ codexHeaderBetaFeatures })}
          disabled={disabled}
        />
      </SettingGroup>

      <SettingGroup
        group="liveRelay"
        description={t('config_management.visual.additions.liveRelayHint')}
      >
        <ToggleSetting
          fieldId="codexLiveMediaRelayEnabled"
          label={t('config_management.visual.additions.codexLiveMediaRelayEnabled.label')}
          description={t('config_management.visual.additions.codexLiveMediaRelayEnabled.hint')}
          checked={values.codexLiveMediaRelayEnabled}
          disabled={disabled}
          onChange={(codexLiveMediaRelayEnabled) => onChange({ codexLiveMediaRelayEnabled })}
        />
        <TextSetting
          fieldId="codexLiveMediaRelayMaxSessions"
          size="sm"
          label={t('config_management.visual.additions.codexLiveMediaRelayMaxSessions.label')}
          description={t('config_management.visual.additions.codexLiveMediaRelayMaxSessions.hint')}
          type="number"
          value={values.codexLiveMediaRelayMaxSessions}
          onChange={(codexLiveMediaRelayMaxSessions) =>
            onChange({ codexLiveMediaRelayMaxSessions })
          }
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.codexLiveMediaRelayMaxSessions)}
        />
        <ToggleSetting
          fieldId="codexLiveMediaRelayDisablePrivateRemoteIPs"
          label={t(
            'config_management.visual.additions.codexLiveMediaRelayDisablePrivateRemoteIPs.label'
          )}
          description={t(
            'config_management.visual.additions.codexLiveMediaRelayDisablePrivateRemoteIPs.hint'
          )}
          checked={values.codexLiveMediaRelayDisablePrivateRemoteIPs}
          disabled={disabled}
          onChange={(codexLiveMediaRelayDisablePrivateRemoteIPs) =>
            onChange({ codexLiveMediaRelayDisablePrivateRemoteIPs })
          }
        />
        <TextSetting
          fieldId="codexLiveMediaRelayPublicIP"
          label={t('config_management.visual.additions.codexLiveMediaRelayPublicIP.label')}
          description={t('config_management.visual.additions.codexLiveMediaRelayPublicIP.hint')}
          value={values.codexLiveMediaRelayPublicIP}
          onChange={(codexLiveMediaRelayPublicIP) => onChange({ codexLiveMediaRelayPublicIP })}
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.codexLiveMediaRelayPublicIP)}
        />
        <TextSetting
          fieldId="codexLiveMediaRelayUDPPortMin"
          size="sm"
          label={t('config_management.visual.additions.codexLiveMediaRelayUDPPortMin.label')}
          description={t('config_management.visual.additions.codexLiveMediaRelayUDPPortMin.hint')}
          type="number"
          value={values.codexLiveMediaRelayUDPPortMin}
          onChange={(codexLiveMediaRelayUDPPortMin) => onChange({ codexLiveMediaRelayUDPPortMin })}
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.codexLiveMediaRelayUDPPortMin)}
        />
        <TextSetting
          fieldId="codexLiveMediaRelayUDPPortMax"
          size="sm"
          label={t('config_management.visual.additions.codexLiveMediaRelayUDPPortMax.label')}
          description={t('config_management.visual.additions.codexLiveMediaRelayUDPPortMax.hint')}
          type="number"
          value={values.codexLiveMediaRelayUDPPortMax}
          onChange={(codexLiveMediaRelayUDPPortMax) => onChange({ codexLiveMediaRelayUDPPortMax })}
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.codexLiveMediaRelayUDPPortMax)}
        />
        <BlockSetting
          fieldId="codexLiveMediaRelayICEServers"
          layout="stack"
          label={t('config_management.visual.additions.codexLiveMediaRelayICEServers.label')}
          description={t('config_management.visual.additions.codexLiveMediaRelayICEServers.hint')}
          error={getValidationMessage(t, validationErrors?.codexLiveMediaRelayICEServers)}
        >
          {({ describedBy, invalid }) => (
            <CodexLiveICEServersEditor
              value={values.codexLiveMediaRelayICEServers}
              disabled={disabled}
              describedBy={describedBy}
              invalid={invalid}
              onChange={(codexLiveMediaRelayICEServers) =>
                onChange({ codexLiveMediaRelayICEServers })
              }
            />
          )}
        </BlockSetting>
      </SettingGroup>

      <SectionProviders
        values={values}
        validationErrors={validationErrors}
        disabled={disabled}
        onChange={onChange}
      />
    </>
  );
}

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginStoreAuthRule } from '@/types/visualConfig';
import type { ConfigSectionProps } from '../../types';
import { PluginStoreAuthEditor } from '../blocks/PluginStoreAuthEditor';
import { StringListEditor } from '../blocks/StringListEditor';
import { getValidationMessage } from '../blocks/shared';
import {
  BlockSetting,
  FieldHint,
  FieldStack,
  SettingGroup,
  TextSetting,
  ToggleSetting,
} from '../fields/FieldPrimitives';

/** Antigravity, Devin, xAI and plugin groups of the Providers & advanced section. */
export function SectionProviders({
  values,
  validationErrors,
  disabled,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();

  const handlePluginStoreSourcesChange = useCallback(
    (pluginStoreSources: string[]) => onChange({ pluginStoreSources }),
    [onChange]
  );
  const handlePluginStoreAuthChange = useCallback(
    (pluginStoreAuth: PluginStoreAuthRule[]) => onChange({ pluginStoreAuth }),
    [onChange]
  );
  const handleAntigravitySensitiveWordsChange = useCallback(
    (antigravitySensitiveWords: string[]) => onChange({ antigravitySensitiveWords }),
    [onChange]
  );
  const handleDevinSensitiveWordsChange = useCallback(
    (devinSensitiveWords: string[]) => onChange({ devinSensitiveWords }),
    [onChange]
  );

  return (
    <>
      <SettingGroup group="antigravity">
        <ToggleSetting
          fieldId="quotaAntigravityCredits"
          label={t('config_management.visual.sections.advanced.antigravity_credits')}
          checked={values.quotaAntigravityCredits}
          disabled={disabled}
          onChange={(quotaAntigravityCredits) => onChange({ quotaAntigravityCredits })}
        />
        <ToggleSetting
          fieldId="antigravityConnectionPoolEnabled"
          label={t('config_management.visual.additions.antigravityConnectionPoolEnabled.label')}
          description={t(
            'config_management.visual.additions.antigravityConnectionPoolEnabled.hint'
          )}
          checked={values.antigravityConnectionPoolEnabled}
          disabled={disabled}
          onChange={(antigravityConnectionPoolEnabled) =>
            onChange({ antigravityConnectionPoolEnabled })
          }
        />
        <TextSetting
          fieldId="antigravityConnectionPoolIdleTimeout"
          size="sm"
          label={t('config_management.visual.additions.antigravityConnectionPoolIdleTimeout.label')}
          description={t(
            'config_management.visual.additions.antigravityConnectionPoolIdleTimeout.hint'
          )}
          value={values.antigravityConnectionPoolIdleTimeout}
          onChange={(antigravityConnectionPoolIdleTimeout) =>
            onChange({ antigravityConnectionPoolIdleTimeout })
          }
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.antigravityConnectionPoolIdleTimeout)}
        />
        <TextSetting
          fieldId="antigravityConnectionPoolMaxIdleConnsPerHost"
          size="sm"
          label={t(
            'config_management.visual.additions.antigravityConnectionPoolMaxIdleConnsPerHost.label'
          )}
          description={t(
            'config_management.visual.additions.antigravityConnectionPoolMaxIdleConnsPerHost.hint'
          )}
          type="number"
          value={values.antigravityConnectionPoolMaxIdleConnsPerHost}
          onChange={(antigravityConnectionPoolMaxIdleConnsPerHost) =>
            onChange({ antigravityConnectionPoolMaxIdleConnsPerHost })
          }
          disabled={disabled}
          error={getValidationMessage(
            t,
            validationErrors?.antigravityConnectionPoolMaxIdleConnsPerHost
          )}
        />
        <ToggleSetting
          fieldId="antigravitySignatureCacheEnabled"
          label={t('config_management.visual.sections.system.antigravity_signature_cache')}
          description={t(
            'config_management.visual.sections.system.antigravity_signature_cache_desc'
          )}
          checked={values.antigravitySignatureCacheEnabled}
          disabled={disabled}
          onChange={(antigravitySignatureCacheEnabled) =>
            onChange({ antigravitySignatureCacheEnabled })
          }
        />
        <ToggleSetting
          fieldId="antigravitySignatureBypassStrict"
          label={t('config_management.visual.sections.system.antigravity_signature_strict')}
          description={t(
            'config_management.visual.sections.system.antigravity_signature_strict_desc'
          )}
          checked={values.antigravitySignatureBypassStrict}
          disabled={disabled}
          onChange={(antigravitySignatureBypassStrict) =>
            onChange({ antigravitySignatureBypassStrict })
          }
        />
        <BlockSetting
          fieldId="antigravitySensitiveWords"
          label={t('config_management.visual.sections.system.antigravity_sensitive_words')}
          description={t(
            'config_management.visual.sections.system.antigravity_sensitive_words_desc'
          )}
        >
          <FieldStack>
            <StringListEditor
              value={values.antigravitySensitiveWords}
              disabled={disabled}
              placeholder={t(
                'config_management.visual.sections.system.antigravity_sensitive_words_placeholder'
              )}
              inputAriaLabel={t(
                'config_management.visual.sections.system.antigravity_sensitive_words'
              )}
              onChange={handleAntigravitySensitiveWordsChange}
            />
            <FieldHint>
              {t('config_management.visual.sections.system.antigravity_sensitive_words_hint')}
            </FieldHint>
          </FieldStack>
        </BlockSetting>
      </SettingGroup>

      <SettingGroup group="devin">
        <BlockSetting
          fieldId="devinSensitiveWords"
          label={t('config_management.visual.sections.system.devin_sensitive_words')}
          description={t('config_management.visual.sections.system.devin_sensitive_words_desc')}
        >
          <FieldStack>
            <StringListEditor
              value={values.devinSensitiveWords}
              disabled={disabled}
              placeholder={t(
                'config_management.visual.sections.system.devin_sensitive_words_placeholder'
              )}
              inputAriaLabel={t('config_management.visual.sections.system.devin_sensitive_words')}
              onChange={handleDevinSensitiveWordsChange}
            />
            <FieldHint>
              {t('config_management.visual.sections.system.devin_sensitive_words_hint')}
            </FieldHint>
          </FieldStack>
        </BlockSetting>
      </SettingGroup>

      <SettingGroup group="xai">
        <ToggleSetting
          fieldId="xaiInjectXSearch"
          label={t('config_management.visual.additions.xaiInjectXSearch.label')}
          description={t('config_management.visual.additions.xaiInjectXSearch.hint')}
          checked={values.xaiInjectXSearch}
          disabled={disabled}
          onChange={(xaiInjectXSearch) => onChange({ xaiInjectXSearch })}
        />
      </SettingGroup>

      <SettingGroup group="plugins">
        <ToggleSetting
          fieldId="pluginsEnabled"
          label={t('config_management.visual.sections.system.plugins_enabled')}
          description={t('config_management.visual.sections.system.plugins_enabled_desc')}
          checked={values.pluginsEnabled}
          disabled={disabled}
          onChange={(pluginsEnabled) => onChange({ pluginsEnabled })}
        />
        <BlockSetting
          fieldId="pluginStoreSources"
          label={t('config_management.visual.sections.system.plugin_store_sources')}
          description={t('config_management.visual.sections.system.plugin_store_sources_desc')}
        >
          <FieldStack>
            <StringListEditor
              value={values.pluginStoreSources}
              disabled={disabled}
              placeholder={t(
                'config_management.visual.sections.system.plugin_store_sources_placeholder'
              )}
              inputAriaLabel={t('config_management.visual.sections.system.plugin_store_sources')}
              onChange={handlePluginStoreSourcesChange}
            />
            <FieldHint>
              {t('config_management.visual.sections.system.plugin_store_sources_hint')}
            </FieldHint>
          </FieldStack>
        </BlockSetting>
        <BlockSetting
          fieldId="pluginStoreAuth"
          layout="stack"
          label={t('config_management.visual.sections.system.plugin_store_auth')}
          description={t('config_management.visual.sections.system.plugin_store_auth_desc')}
        >
          <FieldStack>
            <FieldHint>
              {t('config_management.visual.sections.system.plugin_store_auth_hint')}
            </FieldHint>
            <PluginStoreAuthEditor
              value={values.pluginStoreAuth}
              disabled={disabled}
              onChange={handlePluginStoreAuthChange}
            />
          </FieldStack>
        </BlockSetting>
      </SettingGroup>
    </>
  );
}

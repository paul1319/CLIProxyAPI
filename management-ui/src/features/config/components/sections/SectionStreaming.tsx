import { useTranslation } from 'react-i18next';
import type { ConfigSectionProps } from '../../types';
import { SettingGroup, TextSetting } from '../fields/FieldPrimitives';
import { getValidationMessage } from '../blocks/shared';

/** Streaming: keepalive and bootstrap retries; nonstream-keepalive-interval is a requests-level key. */
export function SectionStreaming({
  values,
  validationErrors,
  disabled,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();
  const { streaming } = values;
  const keepaliveError = getValidationMessage(t, validationErrors?.['streaming.keepaliveSeconds']);
  const nonstreamKeepaliveError = getValidationMessage(
    t,
    validationErrors?.['streaming.nonstreamKeepaliveInterval']
  );
  // 0 / empty means off: tag the input with "Disabled"; a validation error takes its place.
  const disabledBadge = t('config_management.visual.sections.streaming.disabled');
  const isKeepaliveOff = !keepaliveError && Number(streaming.keepaliveSeconds) <= 0;
  const isNonstreamKeepaliveOff =
    !nonstreamKeepaliveError && Number(streaming.nonstreamKeepaliveInterval) <= 0;

  return (
    <>
      <SettingGroup group="streaming">
        <TextSetting
          fieldId="streamingKeepaliveSeconds"
          size="sm"
          label={t('config_management.visual.sections.streaming.keepalive_seconds')}
          description={t('config_management.visual.sections.streaming.keepalive_hint')}
          type="number"
          placeholder="0"
          value={streaming.keepaliveSeconds}
          onChange={(keepaliveSeconds) =>
            onChange({ streaming: { ...streaming, keepaliveSeconds } })
          }
          disabled={disabled}
          error={keepaliveError}
          adornment={isKeepaliveOff ? disabledBadge : undefined}
        />
        <TextSetting
          fieldId="streamingBootstrapRetries"
          size="sm"
          label={t('config_management.visual.sections.streaming.bootstrap_retries')}
          description={t('config_management.visual.sections.streaming.bootstrap_hint')}
          type="number"
          placeholder="1"
          value={streaming.bootstrapRetries}
          onChange={(bootstrapRetries) =>
            onChange({ streaming: { ...streaming, bootstrapRetries } })
          }
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.['streaming.bootstrapRetries'])}
        />
      </SettingGroup>

      <SettingGroup group="nonstream">
        <TextSetting
          fieldId="streamingNonstreamKeepalive"
          size="sm"
          label={t('config_management.visual.sections.streaming.nonstream_keepalive')}
          description={t('config_management.visual.sections.streaming.nonstream_keepalive_hint')}
          type="number"
          placeholder="0"
          value={streaming.nonstreamKeepaliveInterval}
          onChange={(nonstreamKeepaliveInterval) =>
            onChange({ streaming: { ...streaming, nonstreamKeepaliveInterval } })
          }
          disabled={disabled}
          error={nonstreamKeepaliveError}
          adornment={isNonstreamKeepaliveOff ? disabledBadge : undefined}
        />
      </SettingGroup>
    </>
  );
}

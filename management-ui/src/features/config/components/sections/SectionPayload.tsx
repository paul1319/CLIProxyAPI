import { useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@/components/ui/icons';
import type { PayloadFilterRule, PayloadRule } from '@/types/visualConfig';
import { configGroupDomId, findConfigGroup } from '../../groups';
import { configFieldDomId, findConfigFieldById } from '../../searchIndex';
import type { ConfigSectionProps } from '../../types';
import { PayloadFilterRulesEditor } from '../blocks/PayloadFilterRulesEditor';
import { PayloadRulesEditor } from '../blocks/PayloadRulesEditor';
import { useFieldDirty } from '../fields/settingState';
import styles from './SectionPayload.module.scss';

export type SectionPayloadProps = ConfigSectionProps & {
  /** With payload validation errors every group remounts open, so the error is in view. */
  hasPayloadValidationErrors: boolean;
};

/**
 * One payload rule editor as a collapsible panel. The field anchor wraps the native <details>,
 * so a search jump finds it with el.querySelector('details') and opens it.
 */
function PayloadGroup({
  group,
  fieldId,
  description,
  ruleCount,
  defaultOpen,
  children,
}: {
  group: string;
  fieldId: string;
  description: string;
  ruleCount: number;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const dirty = useFieldDirty(fieldId);
  const title = t(findConfigGroup(group)?.titleKey ?? group);
  const yamlKey = findConfigFieldById(fieldId)?.yamlKeys?.join('.');
  return (
    <section id={configGroupDomId(group)} className={styles.group} aria-label={title}>
      <div
        id={configFieldDomId(fieldId)}
        className={`${styles.panel} ${dirty ? styles.panelDirty : ''}`}
        data-dirty={dirty || undefined}
      >
        <details className={styles.details} open={defaultOpen}>
          <summary className={styles.summary}>
            <span className={styles.summaryCopy}>
              <span className={styles.summaryTitle}>
                <span className={styles.title}>{title}</span>
                {yamlKey ? <code className={styles.yamlKey}>{yamlKey}</code> : null}
              </span>
              <span className={styles.description}>{description}</span>
            </span>
            <span className={`${styles.count} ${ruleCount === 0 ? styles.countEmpty : ''}`}>
              {ruleCount === 0
                ? t('config_management.visual.payload_rules.no_rules')
                : t('config_management.payload_rule_count', { count: ruleCount })}
            </span>
            <IconChevronDown size={16} className={styles.chevron} aria-hidden="true" />
          </summary>
          <div className={styles.body}>{children}</div>
        </details>
      </div>
    </section>
  );
}

/** Payload rules: default, raw default, override, raw override and filter rule groups. */
export function SectionPayload({
  values,
  disabled,
  hasPayloadValidationErrors,
  onChange,
}: SectionPayloadProps) {
  const { t } = useTranslation();
  const payloadValidationKey = hasPayloadValidationErrors ? 'payload-errors' : 'payload-ok';

  const handlePayloadDefaultRulesChange = useCallback(
    (payloadDefaultRules: PayloadRule[]) => onChange({ payloadDefaultRules }),
    [onChange]
  );
  const handlePayloadDefaultRawRulesChange = useCallback(
    (payloadDefaultRawRules: PayloadRule[]) => onChange({ payloadDefaultRawRules }),
    [onChange]
  );
  const handlePayloadOverrideRulesChange = useCallback(
    (payloadOverrideRules: PayloadRule[]) => onChange({ payloadOverrideRules }),
    [onChange]
  );
  const handlePayloadOverrideRawRulesChange = useCallback(
    (payloadOverrideRawRules: PayloadRule[]) => onChange({ payloadOverrideRawRules }),
    [onChange]
  );
  const handlePayloadFilterRulesChange = useCallback(
    (payloadFilterRules: PayloadFilterRule[]) => onChange({ payloadFilterRules }),
    [onChange]
  );

  return (
    <div className={styles.stack}>
      <PayloadGroup
        key={`payloadDefaultRules-${payloadValidationKey}`}
        group="payloadDefault"
        fieldId="payloadDefaultRules"
        description={t('config_management.visual.sections.payload.default_rules_desc')}
        ruleCount={values.payloadDefaultRules.length}
        defaultOpen={hasPayloadValidationErrors}
      >
        <PayloadRulesEditor
          value={values.payloadDefaultRules}
          disabled={disabled}
          onChange={handlePayloadDefaultRulesChange}
        />
      </PayloadGroup>

      <PayloadGroup
        key={`payloadDefaultRawRules-${payloadValidationKey}`}
        group="payloadDefaultRaw"
        fieldId="payloadDefaultRawRules"
        description={t('config_management.visual.sections.payload.default_raw_rules_desc')}
        ruleCount={values.payloadDefaultRawRules.length}
        defaultOpen={hasPayloadValidationErrors}
      >
        <PayloadRulesEditor
          value={values.payloadDefaultRawRules}
          disabled={disabled}
          rawJsonValues
          onChange={handlePayloadDefaultRawRulesChange}
        />
      </PayloadGroup>

      <PayloadGroup
        key={`payloadOverrideRules-${payloadValidationKey}`}
        group="payloadOverride"
        fieldId="payloadOverrideRules"
        description={t('config_management.visual.sections.payload.override_rules_desc')}
        ruleCount={values.payloadOverrideRules.length}
        defaultOpen={hasPayloadValidationErrors}
      >
        <PayloadRulesEditor
          value={values.payloadOverrideRules}
          disabled={disabled}
          protocolFirst
          onChange={handlePayloadOverrideRulesChange}
        />
      </PayloadGroup>

      <PayloadGroup
        key={`payloadOverrideRawRules-${payloadValidationKey}`}
        group="payloadOverrideRaw"
        fieldId="payloadOverrideRawRules"
        description={t('config_management.visual.sections.payload.override_raw_rules_desc')}
        ruleCount={values.payloadOverrideRawRules.length}
        defaultOpen={hasPayloadValidationErrors}
      >
        <PayloadRulesEditor
          value={values.payloadOverrideRawRules}
          disabled={disabled}
          protocolFirst
          rawJsonValues
          onChange={handlePayloadOverrideRawRulesChange}
        />
      </PayloadGroup>

      <PayloadGroup
        key={`payloadFilterRules-${payloadValidationKey}`}
        group="payloadFilter"
        fieldId="payloadFilterRules"
        description={t('config_management.visual.sections.payload.filter_rules_desc')}
        ruleCount={values.payloadFilterRules.length}
        defaultOpen={hasPayloadValidationErrors}
      >
        <PayloadFilterRulesEditor
          value={values.payloadFilterRules}
          disabled={disabled}
          onChange={handlePayloadFilterRulesChange}
        />
      </PayloadGroup>
    </div>
  );
}

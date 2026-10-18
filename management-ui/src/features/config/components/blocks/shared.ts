// Pure helpers shared by block editors (kept out of component files so react-refresh only sees
// component exports).

import type { useTranslation } from 'react-i18next';
import type {
  PayloadModelEntry,
  PayloadParamValidationErrorCode,
  VisualConfigValidationErrorCode,
} from '@/types/visualConfig';
import { VISUAL_CONFIG_PROTOCOL_OPTIONS } from '@/hooks/useVisualConfig';

export function getValidationMessage(
  t: ReturnType<typeof useTranslation>['t'],
  errorCode?: VisualConfigValidationErrorCode | PayloadParamValidationErrorCode
) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

export function buildProtocolOptions(
  t: ReturnType<typeof useTranslation>['t'],
  rules: Array<{ models: PayloadModelEntry[] }>
) {
  const options: Array<{ value: string; label: string }> = VISUAL_CONFIG_PROTOCOL_OPTIONS.map(
    (option) => ({
      value: option.value,
      label: t(option.labelKey, { defaultValue: option.defaultLabel }),
    })
  );
  const seen = new Set<string>(options.map((option) => option.value));

  for (const rule of rules) {
    for (const model of rule.models) {
      const protocol = model.protocol;
      if (!protocol || !protocol.trim() || seen.has(protocol)) continue;
      seen.add(protocol);
      options.push({ value: protocol, label: protocol });
    }
  }

  return options;
}

/** Stagger between neighbouring strength segments; four segments finish within ~300ms. */
export const SEGMENT_STAGGER_MS = 45;

/**
 * Fill delay of a strength segment: only newly filled segments queue; lit and cleared segments
 * do not wait. "Generate" lights four segments as a wave while typing +1 segment is instant.
 */
export function segmentFillDelayMs(
  index: number,
  segments: number,
  previousSegments: number
): number {
  const filled = index < segments;
  if (!filled || index < previousSegments) return 0;
  return (index - Math.max(previousSegments, 0)) * SEGMENT_STAGGER_MS;
}

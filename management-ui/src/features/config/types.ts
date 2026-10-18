import type { VisualConfigValidationErrors, VisualConfigValues } from '@/types/visualConfig';

/** Shared section props: values controlled by useVisualConfig plus a patch-style onChange. */
export type ConfigSectionProps = {
  values: VisualConfigValues;
  validationErrors?: VisualConfigValidationErrors;
  disabled: boolean;
  onChange: (patch: Partial<VisualConfigValues>) => void;
};

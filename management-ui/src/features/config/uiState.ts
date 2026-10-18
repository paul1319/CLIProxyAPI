// Pure UI-state layer of the config page: status machine, section badge buckets, dirty-field
// ownership and localStorage readers. Side-effect free; covered by tests/configUiState.test.ts.

import type { VisualConfigValidationErrors } from '@/types/visualConfig';
import {
  CONFIG_SECTION_IDS,
  CONFIG_TAB_IDS,
  DEFAULT_CONFIG_SECTION,
  FIELD_VALUE_KEYS,
  SECTION_VALIDATION_FIELDS,
  type ConfigEditorMode,
  type ConfigTabId,
} from './constants';
import { CONFIG_SECTION_GROUPS } from './groups';
import { CONFIG_FIELD_SEARCH_INDEX, type VisualSectionId } from './searchIndex';

/** Number of settings exposed by the visual editor. */
export const CONFIG_FIELD_COUNT = CONFIG_FIELD_SEARCH_INDEX.length;

/** Leaf value key (= useVisualConfig dirtyFields key) -> fieldId reverse map. */
const VALUE_KEY_TO_FIELD_ID: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [fieldId, valueKeys] of Object.entries(FIELD_VALUE_KEYS)) {
    for (const valueKey of valueKeys) map.set(valueKey, fieldId);
  }
  return map;
})();

const FIELD_ID_TO_SECTION: ReadonlyMap<string, VisualSectionId> = new Map(
  CONFIG_FIELD_SEARCH_INDEX.map((entry) => [entry.fieldId, entry.sectionId])
);

/** Page order of field ids (section → group → row); used to list changes and errors. */
const FIELD_ORDER: ReadonlyMap<string, number> = new Map(
  CONFIG_SECTION_IDS.flatMap((sectionId) =>
    CONFIG_SECTION_GROUPS[sectionId].flatMap((group) => group.fields)
  ).map((fieldId, index) => [fieldId, index])
);

const byFieldOrder = (a: string, b: string) =>
  (FIELD_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) - (FIELD_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER);

/** Dirty value keys -> dirty field ids (setting rows), in page order. */
export function resolveDirtyFieldIds(dirtyFields: ReadonlySet<string>): string[] {
  const fieldIds = new Set<string>();
  for (const valueKey of dirtyFields) {
    const fieldId = VALUE_KEY_TO_FIELD_ID.get(valueKey);
    if (fieldId) fieldIds.add(fieldId);
  }
  return [...fieldIds].sort(byFieldOrder);
}

/** Validation errors -> field ids that currently show an error, in page order. */
export function resolveErrorFieldIds(
  validationErrors: VisualConfigValidationErrors | undefined
): string[] {
  const fieldIds = new Set<string>();
  for (const [valueKey, error] of Object.entries(validationErrors ?? {})) {
    if (!error) continue;
    const fieldId = VALUE_KEY_TO_FIELD_ID.get(valueKey);
    if (fieldId) fieldIds.add(fieldId);
  }
  return [...fieldIds].sort(byFieldOrder);
}

/** Dirty value keys -> sections that show an unsaved dot. */
export function resolveDirtyTabs(dirtyFields: ReadonlySet<string>): ReadonlySet<ConfigTabId> {
  const tabs = new Set<ConfigTabId>();
  for (const fieldId of resolveDirtyFieldIds(dirtyFields)) {
    const sectionId = FIELD_ID_TO_SECTION.get(fieldId);
    if (sectionId) tabs.add(sectionId);
  }
  return tabs;
}

/** Validation error count per section. Payload validation counts as one. */
export function countSectionErrors(
  validationErrors: VisualConfigValidationErrors | undefined,
  hasPayloadValidationErrors: boolean
): Record<ConfigTabId, number> {
  const counts = Object.fromEntries(CONFIG_TAB_IDS.map((tabId) => [tabId, 0])) as Record<
    ConfigTabId,
    number
  >;
  for (const sectionId of CONFIG_SECTION_IDS) {
    counts[sectionId] = SECTION_VALIDATION_FIELDS[sectionId].reduce(
      (total, field) => total + (validationErrors?.[field] ? 1 : 0),
      0
    );
  }
  if (hasPayloadValidationErrors) counts.payload += 1;
  return counts;
}

/** Total validation error count (header meta and save bar). */
export function countTotalErrors(
  validationErrors: VisualConfigValidationErrors | undefined,
  hasPayloadValidationErrors: boolean
): number {
  const fieldErrors = Object.values(validationErrors ?? {}).filter(Boolean).length;
  return fieldErrors + (hasPayloadValidationErrors ? 1 : 0);
}

export type ConfigStatusKey =
  | 'disconnected'
  | 'loading'
  | 'load_failed'
  | 'yaml_error'
  | 'validation_blocked'
  | 'saving'
  | 'dirty'
  | 'synced';

export type ConfigStatusTone = 'error' | 'warning' | 'busy' | 'muted' | 'ok';

export type ConfigStatus = {
  key: ConfigStatusKey;
  /** i18n key of the full status label. */
  labelKey: string;
  /** i18n key of the short label. validation_blocked's short key lives at the config_management
   *  top level (fix for a historical path bug). */
  shortLabelKey: string;
  tone: ConfigStatusTone;
};

export type ConfigStatusInput = {
  disconnected: boolean;
  loading: boolean;
  loadFailed: boolean;
  yamlError: boolean;
  validationBlocked: boolean;
  saving: boolean;
  dirty: boolean;
};

/** Status machine for the header meta and save bar. Precedence runs top-down. */
export function resolveStatus(input: ConfigStatusInput): ConfigStatus {
  if (input.disconnected) {
    return {
      key: 'disconnected',
      labelKey: 'config_management.status_disconnected',
      shortLabelKey: 'config_management.status_disconnected_short',
      tone: 'muted',
    };
  }
  if (input.loading) {
    return {
      key: 'loading',
      labelKey: 'config_management.status_loading',
      shortLabelKey: 'config_management.status_loading_short',
      tone: 'busy',
    };
  }
  if (input.loadFailed) {
    return {
      key: 'load_failed',
      labelKey: 'config_management.status_load_failed',
      shortLabelKey: 'config_management.status_load_failed_short',
      tone: 'error',
    };
  }
  if (input.yamlError) {
    return {
      key: 'yaml_error',
      labelKey: 'config_management.visual_mode_unavailable',
      shortLabelKey: 'config_management.visual_mode_unavailable_short',
      tone: 'error',
    };
  }
  if (input.validationBlocked) {
    return {
      key: 'validation_blocked',
      labelKey: 'config_management.visual.validation.validation_blocked',
      shortLabelKey: 'config_management.validation_blocked_short',
      tone: 'error',
    };
  }
  if (input.saving) {
    return {
      key: 'saving',
      labelKey: 'config_management.status_saving',
      shortLabelKey: 'config_management.status_saving_short',
      tone: 'busy',
    };
  }
  if (input.dirty) {
    return {
      key: 'dirty',
      labelKey: 'config_management.status_dirty',
      shortLabelKey: 'config_management.status_dirty_short',
      tone: 'warning',
    };
  }
  return {
    key: 'synced',
    labelKey: 'config_management.status_loaded',
    shortLabelKey: 'config_management.status_loaded_short',
    tone: 'ok',
  };
}

export type HeaderMetaSegment = {
  key: 'fields' | ConfigStatusKey | 'dirty_source' | 'errors';
  labelKey: string;
  count?: number;
  tone: 'muted' | 'warning' | 'error' | 'ok';
};

export type HeaderMetaInput = {
  fieldCount: number;
  status: ConfigStatus;
  dirtyCount: number;
  sourceDirty: boolean;
  errorCount: number;
};

/**
 * Header meta segments derived from the page status machine, so the header and the save bar never
 * derive connection/loading state separately. Blocking states win; editing states then add the
 * unsaved and validation error counts. The field count segment comes first.
 */
export function buildHeaderMeta(input: HeaderMetaInput): HeaderMetaSegment[] {
  const segments: HeaderMetaSegment[] = [
    {
      key: 'fields',
      labelKey: 'config_management.meta_fields',
      count: input.fieldCount,
      tone: 'muted',
    },
  ];
  const { status } = input;

  if (
    status.key === 'disconnected' ||
    status.key === 'loading' ||
    status.key === 'load_failed' ||
    status.key === 'saving'
  ) {
    segments.push({
      key: status.key,
      labelKey: status.labelKey,
      tone: status.tone === 'busy' ? 'muted' : status.tone,
    });
    return segments;
  }
  if (status.key === 'yaml_error') {
    segments.push({
      key: status.key,
      labelKey: status.shortLabelKey,
      tone: 'error',
    });
  }
  if (input.sourceDirty) {
    segments.push({
      key: 'dirty_source',
      labelKey: 'config_management.meta_dirty_source',
      tone: 'warning',
    });
  } else if (input.dirtyCount > 0) {
    segments.push({
      key: 'dirty',
      labelKey: 'config_management.meta_dirty',
      count: input.dirtyCount,
      tone: 'warning',
    });
  }
  if (input.errorCount > 0) {
    segments.push({
      key: 'errors',
      labelKey: 'config_management.meta_errors',
      count: input.errorCount,
      tone: 'error',
    });
  }
  if (status.key === 'synced') {
    segments.push({ key: status.key, labelKey: 'config_management.meta_synced', tone: 'ok' });
  }
  return segments;
}

/** localStorage readers: invalid or stale values fall back to defaults. */
export function readSavedMode(raw: string | null): ConfigEditorMode {
  return raw === 'source' ? 'source' : 'visual';
}

export function readSavedSection(raw: string | null): ConfigTabId {
  return raw !== null && (CONFIG_TAB_IDS as readonly string[]).includes(raw)
    ? (raw as ConfigTabId)
    : DEFAULT_CONFIG_SECTION;
}

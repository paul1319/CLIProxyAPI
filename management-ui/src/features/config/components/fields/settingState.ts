import { createContext, useContext } from 'react';

const NO_DIRTY_FIELDS: ReadonlySet<string> = new Set();

/**
 * Field ids (search index ids) whose value differs from the loaded server config. Provided by the
 * config page around the active section; setting rows read it to draw the unsaved marker.
 */
export const DirtyFieldsContext = createContext<ReadonlySet<string>>(NO_DIRTY_FIELDS);

export function useFieldDirty(fieldId: string): boolean {
  return useContext(DirtyFieldsContext).has(fieldId);
}

/**
 * Shared types for the provider model editors (used by credential policy fields).
 */

import type { ThinkingLevel } from './thinkingLevels';
import type { ModelOptionsInput } from './modelOptions';

export type ProviderBrand =
  | 'gemini'
  | 'interactions'
  | 'codex'
  | 'meta'
  | 'xai'
  | 'claude'
  | 'vertex'
  | 'openaiCompatibility';

/** One editable model row. */
export interface ModelEntryInput extends ModelOptionsInput {
  /** Only used by the OAuth alias editor. */
  fork?: boolean;
  sourceIndex?: number | null;
  name: string;
  alias?: string;
  priority?: number;
  image?: boolean;
  /** Original backend value, preserved until the standard-level selector is changed. */
  thinkingJson?: string;
  thinkingLevels?: ThinkingLevel[];
  thinkingLevelsTouched?: boolean;
}

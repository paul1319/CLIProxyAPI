export interface ModelOptionsInput {
  displayName?: string;
  maxContextLength?: string;
  forceMapping?: boolean;
  isCompat?: boolean;
  supportConfigurationUpdate?: boolean;
  inputModalitiesText?: string;
  outputModalitiesText?: string;
  originalInputModalities?: string[];
  originalOutputModalities?: string[];
  inputModalitiesTouched?: boolean;
  outputModalitiesTouched?: boolean;
  useMaxCompletionTokens?: boolean;
  thinkingEnabled?: boolean;
  thinkingMin?: string;
  thinkingMax?: string;
  thinkingZeroAllowed?: boolean;
  thinkingDynamicAllowed?: boolean;
  thinkingBudgetTouched?: boolean;
}

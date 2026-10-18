/**
 * Excluded-model rules: the single source of pure logic.
 *
 * Merged from two deleted modules, `excludedModelSelection.ts` (text/array based) and
 * `oauthExcludedRules.ts` (Set based), which implemented the same domain model twice with
 * identical normalization, one over newline-separated text and one over iterables.
 *
 * Rule semantics (matching the backend):
 * - case-insensitive;
 * - `*` matches any characters, everything else is literal (the `.` in `gpt-4.1` is not a regex wildcard);
 * - deduplicated by lowercase key, keeping the **first spelling seen**.
 */

const ruleKey = (value: string): string => value.trim().toLowerCase();

export const isWildcardRule = (rule: string): boolean => rule.includes('*');

export function normalizeExcludedRules(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const rules: string[] = [];

  for (const value of values) {
    const rule = value.trim();
    const key = ruleKey(rule);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }

  return rules;
}

export const parseExcludedRulesText = (text: string): string[] =>
  normalizeExcludedRules(text.split(/\r?\n/));

export const formatExcludedRulesText = (rules: readonly string[]): string => rules.join('\n');

export function matchesExcludedRule(rule: string, modelId: string): boolean {
  const normalizedRule = ruleKey(rule);
  const normalizedModel = ruleKey(modelId);
  if (!normalizedRule || !normalizedModel) return false;
  if (!isWildcardRule(normalizedRule)) return normalizedRule === normalizedModel;

  // Split on `*`, escape regex metacharacters in each part, then join with `.*`: only `*` is a wildcard.
  const escaped = normalizedRule
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'i').test(normalizedModel);
}

/** Whether the model is matched by a **wildcard** rule (exact rules do not count). */
export const isMatchedByWildcardRule = (rules: Iterable<string>, modelId: string): boolean =>
  Array.from(rules).some((rule) => isWildcardRule(rule) && matchesExcludedRule(rule, modelId));

/** Whether the list contains a rule literally equal to candidate (case-insensitive). No wildcard expansion. */
export function hasExcludedRule(rules: Iterable<string>, candidate: string): boolean {
  const candidateKey = ruleKey(candidate);
  if (!candidateKey) return false;
  return Array.from(rules).some((rule) => ruleKey(rule) === candidateKey);
}

/**
 * Add or remove one literal rule.
 *
 * Note: this filters by key and does **not** exempt rules containing `*`. The old
 * `toggleExcludedModel` refused to remove wildcard rules because two unaware writers (the list for
 * exact rules, the textarea for wildcards) had to avoid clobbering each other. In the unified
 * component both live in one place, so that guard belongs to the component, not this pure function.
 */
export function toggleExcludedRule(
  rules: Iterable<string>,
  candidate: string,
  excluded: boolean
): string[] {
  const candidateRule = candidate.trim();
  const candidateKey = ruleKey(candidateRule);
  const next = normalizeExcludedRules(rules).filter((rule) => ruleKey(rule) !== candidateKey);

  if (excluded && candidateKey) next.push(candidateRule);
  return next;
}

export interface SplitExcludedRules {
  /** Exact rules found in the catalog, **rewritten to the catalog spelling** (checkbox driven, ids are canonical). */
  exactRules: string[];
  /** Rules containing `*`, keeping the configured spelling. */
  wildcardRules: string[];
  /** Exact rules missing from the catalog (e.g. retired model ids), keeping the configured spelling. */
  unknownRules: string[];
  /** `wildcardRules ∪ unknownRules` in **original order**; the textarea content and order-sensitive diffs rely on it. */
  customRules: string[];
}

export function splitExcludedRules(
  rules: Iterable<string>,
  candidateIds: readonly string[]
): SplitExcludedRules {
  const candidateByKey = new Map(candidateIds.map((id) => [ruleKey(id), id]));
  const exactRules: string[] = [];
  const wildcardRules: string[] = [];
  const unknownRules: string[] = [];
  const customRules: string[] = [];

  normalizeExcludedRules(rules).forEach((rule) => {
    if (isWildcardRule(rule)) {
      wildcardRules.push(rule);
      customRules.push(rule);
      return;
    }
    const candidate = candidateByKey.get(ruleKey(rule));
    if (candidate) {
      exactRules.push(candidate);
      return;
    }
    unknownRules.push(rule);
    customRules.push(rule);
  });

  return { exactRules, wildcardRules, unknownRules, customRules };
}

/** Replace the "custom" half (wildcards + exact rules outside the catalog) with text, keeping the checked exact half. */
export function replaceCustomExcludedRules(
  rules: Iterable<string>,
  candidateIds: readonly string[],
  text: string
): string[] {
  const { exactRules } = splitExcludedRules(rules, candidateIds);
  return normalizeExcludedRules([...exactRules, ...parseExcludedRulesText(text)]);
}

/* -------------------------------------------------------------------------- */
/* Derived values for display                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Exclusion state of one model.
 *
 * `both` is the subtle case: the model is checked explicitly and also matched by a wildcard rule.
 * Unchecking it leaves it **still excluded**, so the row must not look unchecked, or the user would
 * think the click failed. The old UI hid this case entirely.
 */
export type ModelExclusionState =
  | { state: 'included' }
  | { state: 'excluded'; by: 'exact' }
  | { state: 'excluded'; by: 'wildcard'; rule: string }
  | { state: 'excluded'; by: 'both'; rule: string };

export function getModelExclusionState(
  rules: readonly string[],
  modelId: string
): ModelExclusionState {
  const modelKey = ruleKey(modelId);
  if (!modelKey) return { state: 'included' };

  let hasExact = false;
  let wildcard: string | undefined;

  for (const rule of rules) {
    if (isWildcardRule(rule)) {
      if (wildcard === undefined && matchesExcludedRule(rule, modelId)) wildcard = rule;
    } else if (!hasExact && ruleKey(rule) === modelKey) {
      hasExact = true;
    }
  }

  if (hasExact && wildcard !== undefined) return { state: 'excluded', by: 'both', rule: wildcard };
  if (hasExact) return { state: 'excluded', by: 'exact' };
  if (wildcard !== undefined) return { state: 'excluded', by: 'wildcard', rule: wildcard };
  return { state: 'included' };
}

export const isModelExcluded = (rules: readonly string[], modelId: string): boolean =>
  getModelExclusionState(rules, modelId).state === 'excluded';

export interface RuleMatchSummary {
  rule: string;
  /** Catalog models matched by this rule, in catalog order. */
  matched: string[];
  matchCount: number;
}

/** Which catalog models each rule matches; drives the wildcard editor's live feedback. */
export const matchedModelsByRule = (
  rules: readonly string[],
  candidateIds: readonly string[]
): RuleMatchSummary[] =>
  rules.map((rule) => {
    const matched = candidateIds.filter((id) => matchesExcludedRule(rule, id));
    return { rule, matched, matchCount: matched.length };
  });

export interface ExclusionStats {
  total: number;
  excluded: number;
  available: number;
}

/**
 * Data for the summary line and meter.
 *
 * `excluded` counts **catalog models matched by any rule**, not `rules.length`: one `gpt-5-*`
 * may match six models or none. Using the rule count as numerator would repeat the old UI's
 * mistake; numerator and denominator must come from the same set for the meter to be honest.
 */
export function summarizeExclusion(
  rules: readonly string[],
  candidateIds: readonly string[]
): ExclusionStats {
  const total = candidateIds.length;
  const excluded = candidateIds.reduce(
    (count, id) => (isModelExcluded(rules, id) ? count + 1 : count),
    0
  );
  return { total, excluded, available: total - excluded };
}

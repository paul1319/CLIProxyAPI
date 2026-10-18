/**
 * Quota page pure logic: file classification, provider filtering, counts and
 * sorting. React-free, consumed directly by tests/quotaPageLogic.test.ts.
 */

import type { AuthFileItem } from '@/types';
import { getQuotaCardTitle } from '@/utils/quota/identity';
import { ANTIGRAVITY_CONFIG } from './providers/antigravity/data';
import { CLAUDE_CONFIG } from './providers/claude/data';
import { CODEX_CONFIG } from './providers/codex/data';
import { DEVIN_CONFIG } from './providers/devin/data';
import { KIMI_CONFIG } from './providers/kimi/data';
import { META_CONFIG } from './providers/meta/data';
import { PLUGIN_CONFIG } from './providers/plugin/data';
import { XAI_CONFIG } from './providers/xai/data';
import type { QuotaProviderType } from './providers/types';
import { QUOTA_TAB_ORDER, type QuotaSortMode, type QuotaTabId } from './constants';

const QUOTA_FILTER_MAP: Record<QuotaProviderType, (file: AuthFileItem) => boolean> = {
  antigravity: ANTIGRAVITY_CONFIG.filterFn,
  claude: CLAUDE_CONFIG.filterFn,
  codex: CODEX_CONFIG.filterFn,
  devin: DEVIN_CONFIG.filterFn,
  kimi: KIMI_CONFIG.filterFn,
  meta: META_CONFIG.filterFn,
  plugin: PLUGIN_CONFIG.filterFn,
  xai: XAI_CONFIG.filterFn,
};

export interface QuotaFileEntry {
  file: AuthFileItem;
  type: QuotaProviderType;
}

/** A refresh-all intent belongs to the session that requested a successful list read. */
export function canRefreshQuotaAfterList(
  requestedSession: number,
  currentSession: number,
  filesSession: number | null,
  hasError: boolean,
  disabled: boolean
): boolean {
  return (
    !disabled && !hasError && requestedSession === currentSession && filesSession === currentSession
  );
}

export const resolveQuotaProviderType = (file: AuthFileItem): QuotaProviderType | null =>
  PLUGIN_CONFIG.filterFn(file)
    ? 'plugin'
    : (QUOTA_TAB_ORDER.find((type) => QUOTA_FILTER_MAP[type](file)) ?? null);

/**
 * Classify the file list into quota entries. Files without quota support or
 * disabled files are dropped; the result is grouped in QUOTA_TAB_ORDER, which
 * is also the order of the provider sections on the page.
 */
export function classifyQuotaFiles(files: AuthFileItem[]): QuotaFileEntry[] {
  const groups = new Map<QuotaProviderType, QuotaFileEntry[]>(
    QUOTA_TAB_ORDER.map((type) => [type, []])
  );
  for (const file of files) {
    const type = resolveQuotaProviderType(file);
    if (!type) continue;
    groups.get(type)?.push({ file, type });
  }
  return QUOTA_TAB_ORDER.flatMap((type) => groups.get(type) ?? []);
}

export function filterEntriesByTab(entries: QuotaFileEntry[], tab: QuotaTabId): QuotaFileEntry[] {
  if (tab === 'all') return entries;
  return entries.filter((entry) => entry.type === tab);
}

/**
 * Order the rows.
 *
 * - `name`: provider order, then the account title, so provider sections stay
 *   contiguous and the default never reshuffles on a refresh.
 * - `remaining` / `soonest`: ascending by the injected key (least remaining
 *   capacity, or soonest capacity return). The key is injected rather than
 *   read here because quota lives in the store and arrives asynchronously;
 *   keeping this function store-free makes the ordering directly testable.
 *
 * Entries without a key — not loaded yet, failed, or (for `soonest`) not
 * constrained at all — sink to the bottom in their incoming order. The
 * original index is the final tiebreak, so stability is asserted rather than
 * assumed of the engine's sort.
 */
export function sortQuotaEntries(
  entries: QuotaFileEntry[],
  mode: QuotaSortMode,
  resolveKey: (entry: QuotaFileEntry) => number | null = () => null
): QuotaFileEntry[] {
  if (mode === 'name') {
    const providerIndex = (entry: QuotaFileEntry) => QUOTA_TAB_ORDER.indexOf(entry.type);
    return entries
      .map((entry, index) => ({ entry, index, title: getQuotaCardTitle(entry.file) }))
      .sort(
        (a, b) =>
          providerIndex(a.entry) - providerIndex(b.entry) ||
          a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }) ||
          a.index - b.index
      )
      .map((decorated) => decorated.entry);
  }

  // Decorate once — resolving pokes at provider-shaped state per entry.
  return entries
    .map((entry, index) => ({ entry, index, key: resolveKey(entry) }))
    .sort((a, b) => {
      if (a.key === null && b.key === null) return a.index - b.index;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      return a.key - b.key || a.index - b.index;
    })
    .map((decorated) => decorated.entry);
}

export function buildTabCounts(entries: QuotaFileEntry[]): Record<string, number> {
  const counts: Record<string, number> = { all: entries.length };
  for (const type of QUOTA_TAB_ORDER) {
    counts[type] = 0;
  }
  for (const entry of entries) {
    counts[entry.type] += 1;
  }
  return counts;
}

export const isQuotaRefreshDisabled = (
  canRefresh: boolean,
  loading: boolean,
  resetting: boolean
): boolean => !canRefresh || loading || resetting;

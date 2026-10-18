/**
 * Pure credential-list logic: wildcard search, field matching, health, filtering, sorting.
 * React-free — consumed directly by tests/authFilesListLogic.test.ts and
 * tests/authFilesSelection.test.ts.
 */

import type { AuthFileItem } from '@/types';
import { getCredentialLampState } from '@/components/layout/poolRail';
import type { LampState } from '@/components/ui/StatusLamp';
import { isPluginQuotaFile, resolveAuthProvider } from '@/utils/quota';
import {
  QUOTA_PROVIDER_TYPES,
  getAuthFileStatusMessage,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  type AuthFileQuotaFilter,
  type QuotaProviderType,
} from './constants';
import { deriveAuthFileIdentity } from './identity';
import type { AuthFilesSortMode, AuthFilesStatusFilterMode } from './uiState';

const escapeWildcardSearchSegment = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Returns null without '*' (plain includes path). Deliberately unanchored — substring semantics. */
export const buildWildcardSearch = (value: string): RegExp | null => {
  if (!value.includes('*')) return null;
  const pattern = value.split('*').map(escapeWildcardSearchSegment).join('.*');
  return new RegExp(pattern, 'i');
};

/** "All" shows each supported credential's own quota; a provider filter only shows matching quota. */
export const resolveAuthFileQuotaType = (
  file: AuthFileItem,
  filter: AuthFileQuotaFilter
): QuotaProviderType | null => {
  if (!filter) return null;

  const provider = resolveAuthProvider(file);
  if (isPluginQuotaFile(file)) {
    if (filter !== 'all' && filter !== 'plugin' && provider !== filter) return null;
    return 'plugin';
  }
  if (QUOTA_PROVIDER_TYPES.has(provider as QuotaProviderType)) {
    if (filter !== 'all' && provider !== filter) return null;
    return provider as QuotaProviderType;
  }

  return null;
};

/**
 * Search haystack: file name + type + provider + email + project ID + status/error message.
 * Explicitly excludes `account` — for api-key credentials it is the API key itself (see identity.ts).
 */
export const matchesAuthFileSearch = (
  file: AuthFileItem,
  term: string,
  wildcard: RegExp | null
): boolean => {
  if (!term) return true;
  const needle = term.toLowerCase();
  return [
    file.name,
    file.type,
    file.provider,
    file.email,
    file.projectId,
    getAuthFileStatusMessage(file),
  ].some((value) => {
    const content = (value || '').toString();
    return wildcard ? wildcard.test(content) : content.toLowerCase().includes(needle);
  });
};

/** Returns a new array; never mutates the input. Unknown modes return an unsorted copy. */
export const sortAuthFiles = (files: AuthFileItem[], mode: AuthFilesSortMode): AuthFileItem[] => {
  const copy = [...files];
  if (mode === 'default') {
    copy.sort((a, b) => {
      const providerA = normalizeProviderKey(String(a.provider ?? a.type ?? 'unknown'));
      const providerB = normalizeProviderKey(String(b.provider ?? b.type ?? 'unknown'));
      const providerCompare = providerA.localeCompare(providerB);
      if (providerCompare !== 0) return providerCompare;
      return a.name.localeCompare(b.name);
    });
  } else if (mode === 'az') {
    // Sort by the visible primary line (the email when present); file name breaks ties.
    // Decorate once so the comparator does not re-derive identities.
    const keys = new Map(copy.map((file) => [file, deriveAuthFileIdentity(file).primary]));
    copy.sort(
      (a, b) => (keys.get(a) ?? '').localeCompare(keys.get(b) ?? '') || a.name.localeCompare(b.name)
    );
  } else if (mode === 'priority') {
    copy.sort((a, b) => {
      const pa = typeof a.priority === 'number' ? a.priority : 0;
      const pb = typeof b.priority === 'number' ? b.priority : 0;
      return pb - pa; // Higher priority first
    });
  }
  return copy;
};

/* ---------- Health ---------- */

export type AuthFileHealth = 'serving' | 'cooling' | 'failing' | 'disabled';

const HEALTH_BY_LAMP: Record<LampState, AuthFileHealth> = {
  ok: 'serving',
  warn: 'cooling',
  fault: 'failing',
  idle: 'disabled',
};

/** Same classification as the sidebar pool rail, so the two never disagree. */
export const getAuthFileHealth = (file: AuthFileItem): AuthFileHealth =>
  HEALTH_BY_LAMP[getCredentialLampState(file)];

export const lampForHealth = (health: AuthFileHealth): LampState =>
  health === 'serving'
    ? 'ok'
    : health === 'cooling'
      ? 'warn'
      : health === 'failing'
        ? 'fault'
        : 'idle';

/**
 * Status segments partition the pool: Serving + Problem (cooling or failing) + Disabled = All.
 * The persisted value 'enabled' predates the redesign and now means "Serving".
 */
export const matchesStatusFilter = (file: AuthFileItem, mode: AuthFilesStatusFilterMode) => {
  if (mode === 'all') return true;
  const health = getAuthFileHealth(file);
  if (mode === 'enabled') return health === 'serving';
  if (mode === 'disabled') return health === 'disabled';
  return health === 'cooling' || health === 'failing';
};

export type AuthFileHealthCounts = Record<AuthFileHealth, number> & { total: number };

export const countAuthFileHealth = (files: AuthFileItem[]): AuthFileHealthCounts => {
  const counts: AuthFileHealthCounts = {
    total: files.length,
    serving: 0,
    cooling: 0,
    failing: 0,
    disabled: 0,
  };
  files.forEach((file) => {
    counts[getAuthFileHealth(file)] += 1;
  });
  return counts;
};

/* ---------- Filtering & selection ---------- */

export const getAuthFileProviderKey = (file: AuthFileItem): string =>
  normalizeProviderKey(String(file.type ?? file.provider ?? ''));

export type AuthFilesFilter = {
  /** Normalized provider key, or 'all'. */
  provider: string;
  status: AuthFilesStatusFilterMode;
  search: string;
};

/** The single filter pipeline behind the visible list, counts and "select all matching". */
export const filterAuthFiles = (files: AuthFileItem[], filter: AuthFilesFilter): AuthFileItem[] => {
  const term = filter.search.trim();
  const wildcard = buildWildcardSearch(term);
  return files.filter(
    (file) =>
      (filter.provider === 'all' || getAuthFileProviderKey(file) === filter.provider) &&
      matchesStatusFilter(file, filter.status) &&
      matchesAuthFileSearch(file, term, wildcard)
  );
};

/** Names a bulk action may target: every matching credential except runtime-only ones. */
export const getSelectableNames = (files: AuthFileItem[]): string[] =>
  files.filter((file) => !isRuntimeOnlyAuthFile(file)).map((file) => file.name);

/**
 * Bulk actions only ever act on selected credentials that are currently visible under the
 * full filter (provider + status + search). A selection made before narrowing the search can
 * never delete rows the operator no longer sees.
 */
export const getSelectedMatchingNames = (
  selected: ReadonlySet<string>,
  matching: AuthFileItem[]
): string[] => {
  if (selected.size === 0) return [];
  return Array.from(new Set(getSelectableNames(matching).filter((name) => selected.has(name))));
};

import type { AuthFileItem } from '@/types';
import { normalizeRecentRequestAuthIndex } from '@/utils/recentRequests';
import { isDevinFile, isPluginQuotaFile } from './validators';

const QUOTA_IDENTITY_SEPARATOR = '\0';

/**
 * Devin and backend quota providers can expose multiple credential identities
 * from one physical file, distinguished by auth_index.
 */
export function getQuotaCacheKey(file: AuthFileItem): string {
  const identity = file.quota_identity;
  if (typeof identity === 'string' && identity) {
    return `${file.name}${QUOTA_IDENTITY_SEPARATOR}${normalizeRecentRequestAuthIndex(file.authIndex) ?? ''}${QUOTA_IDENTITY_SEPARATOR}${identity}${QUOTA_IDENTITY_SEPARATOR}${isPluginQuotaFile(file) ? (file.quotaPluginId ?? '') : ''}`;
  }
  if (!isDevinFile(file) && !isPluginQuotaFile(file)) return file.name;
  const authIndex = normalizeRecentRequestAuthIndex(file.authIndex);
  return `${file.name}${QUOTA_IDENTITY_SEPARATOR}${authIndex ?? ''}`;
}

/** Disambiguate same-name cards without ever falling back to account (a secret). */
export function getQuotaDisplayName(file: AuthFileItem): string {
  if (!isDevinFile(file) && !isPluginQuotaFile(file)) return file.name;
  const identity = file.email?.trim() || normalizeRecentRequestAuthIndex(file.authIndex);
  return identity ? `${file.name} · ${identity}` : file.name;
}

/**
 * Card title: the account email when known, otherwise the display name without
 * the `.json` extension or a generated `claude-<8 hex>-` style prefix.
 * Never falls back to `account`, which holds the API key for key-based files.
 */
export function getQuotaCardTitle(file: AuthFileItem): string {
  const email = typeof file.email === 'string' ? file.email.trim() : '';
  if (email) return email;
  return getQuotaDisplayName(file)
    .replace(/\.json(?=$| · )/i, '')
    .replace(/^(?:claude|codex|xai)-[a-f\d]{8}-/i, '');
}

/** Resolve a cache identity back to the physical filename used by file mutations. */
export function getQuotaCacheFileName(key: string): string {
  const separatorIndex = key.indexOf(QUOTA_IDENTITY_SEPARATOR);
  return separatorIndex === -1 ? key : key.slice(0, separatorIndex);
}

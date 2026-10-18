import type { AuthFileItem } from '@/types';

/**
 * Credential provider keys that differ from the OAuth provider id used to start sign-in.
 * Everything else (codex, kimi, kimi-ai, meta, devin, plugin providers, vertex) matches 1:1.
 */
const OAUTH_ID_TO_CREDENTIAL_KEY: Record<string, string> = {
  anthropic: 'claude',
};

const CREDENTIAL_KEY_ALIASES: Record<string, string> = {
  anthropic: 'claude',
  'x-ai': 'xai',
  grok: 'xai',
};

/** Normalizes a credential's provider/type into the key used for counting. */
export const credentialProviderKey = (file: Pick<AuthFileItem, 'provider' | 'type'>): string => {
  const raw = String(file.provider ?? file.type ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  return CREDENTIAL_KEY_ALIASES[raw] ?? raw;
};

export type ConnectedCounts = Record<string, number>;

/** Groups credentials by provider key. Kimi China and Kimi International stay separate. */
export const countCredentialsByProvider = (
  files: ReadonlyArray<Pick<AuthFileItem, 'provider' | 'type'>>
): ConnectedCounts => {
  const counts: ConnectedCounts = {};
  for (const file of files) {
    const key = credentialProviderKey(file);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

/** Connected credentials for an OAuth provider id (or `vertex`); 0 when none are pooled. */
export const connectedCountFor = (counts: ConnectedCounts, oauthId: string): number =>
  counts[OAUTH_ID_TO_CREDENTIAL_KEY[oauthId] ?? oauthId] ?? 0;

import { apiClient } from '@/services/api/client';
import {
  AnthropicResetGrantError,
  parseAnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';
import { quotaApi, type QuotaReadOptions } from '@/services/api/quota';

async function readCardResetGrants(authIndex: string, options?: QuotaReadOptions) {
  const response = await quotaApi.read(authIndex, 'reset_grants', options);
  if (response.statusCode === 429) throw new AnthropicResetGrantError('rate_limited');
  if (response.statusCode !== 200) throw new AnthropicResetGrantError('upstream');
  const body = response.body as { cedar_ember?: unknown } | null;
  const status = parseAnthropicResetGrantStatus(body?.cedar_ember);
  if (!status) throw new AnthropicResetGrantError('malformed');
  return status;
}

export const RESET_GRANT_READ_DELAY_MS = 2000;

/** One delayed attempt per effect activation, never an automatic retry. */
export function scheduleResetGrantRead(start: () => void, current: () => boolean) {
  const timeout = setTimeout(() => {
    if (current()) start();
  }, RESET_GRANT_READ_DELAY_MS);
  return () => clearTimeout(timeout);
}

/** Only card reads are shared. Spending still performs its own fresh preflight reads. */
export function createResetGrantReader(
  deps = {
    revision: () => apiClient.getConnectionRevision(),
    read: readCardResetGrants,
  }
) {
  let session = deps.revision();
  const inFlight = new Map<string, ReturnType<typeof readCardResetGrants>>();
  return (authIndex: string, options?: QuotaReadOptions) => {
    const revision = deps.revision();
    if (revision !== session) {
      session = revision;
      inFlight.clear();
    }
    const key = JSON.stringify([authIndex, options?.mode, options?.forceDetails]);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const request = deps
      .read(authIndex, options)
      .then((result) => {
        if (deps.revision() !== revision) throw new Error('session');
        return result;
      })
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  };
}

export const readResetGrantsForCard = createResetGrantReader();

import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import type { QuotaReadOptions } from '@/services/api/quota';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/stores/useQuotaStore';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { createStatusError, getStatusFromError } from '@/utils/quota';
import { getQuotaSetter, type QuotaAdapter, type QuotaCardState } from './providers';
import { enrichQuotaInBackground } from './quotaEnrichment';

const inFlight = new Map<string, Promise<void>>();

/** Only a user-initiated network read may put a card or toolbar into a visible loading state. */
export const isVisibleQuotaLoad = (options: QuotaReadOptions = {}): boolean =>
  !options.automatic && options.mode !== 'cached';

/**
 * Whether a read should replace the card with its loading state.
 *
 * Background polling runs every 15 seconds. Flipping an observed card into
 * `loading` each time spun every refresh icon, disabled reset actions and made
 * error-only cards flash "Loading" between two identical errors. An automatic
 * read therefore keeps whatever is on screen and only an unobserved card (or a
 * manual read) shows progress.
 */
export function shouldEnterLoadingState(
  existing: QuotaCardState | undefined,
  options: QuotaReadOptions
): boolean {
  if (options.mode === 'cached') return false;
  if (!options.automatic) return true;
  return !existing || existing.status === 'idle';
}

/** All card hosts share loading, restore, session isolation and observation metadata. */
export function loadQuotaEntry(
  file: AuthFileItem,
  adapter: QuotaAdapter,
  t: TFunction,
  requested: QuotaReadOptions = {}
): Promise<void> {
  if (
    file.disabled ||
    (requested.automatic && adapter.type === 'plugin' && requested.mode !== 'cached')
  )
    return Promise.resolve();
  const cacheKey = getQuotaCacheKey(file);
  const generation = captureQuotaCacheGeneration(file.name);
  const key = JSON.stringify([
    useQuotaStore.getState().cacheGeneration,
    useQuotaStore.getState().fileGenerations[file.name],
    adapter.type,
    cacheKey,
    requested.mode === 'cached',
  ]);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const setQuota = getQuotaSetter(adapter);
  const options: QuotaReadOptions = { ...requested };
  const execute = async () => {
    let observed = false;
    if (shouldEnterLoadingState(adapter.storeSelector(useQuotaStore.getState())[cacheKey], options))
      setQuota((previous) => ({ ...previous, [cacheKey]: adapter.buildLoadingState() }));
    try {
      const fetched = await adapter.fetchQuota(file, t, options);
      // A visible observation stays on screen meanwhile, so commit primary and optional
      // metadata together instead of flashing the card through the un-enriched state.
      const enrich = adapter.storeSelector(useQuotaStore.getState())[cacheKey]?.hasData
        ? adapter.enrichQuota
        : undefined;
      const data = enrich ? await enrich(file, fetched, t, options).catch(() => fetched) : fetched;
      commitIfQuotaCacheCurrent(generation, () => {
        const state: QuotaCardState = {
          ...adapter.buildSuccessState(data),
          status: options.errorStatus ? 'error' : 'success',
          error: options.errorStatus ? `HTTP ${options.errorStatus}` : undefined,
          hasData: true,
          observedAt: options.observedAt,
          stale: options.stale,
          errorStatus: options.errorStatus,
          persistenceError: options.persistenceError,
          retryAt: options.errorStatus ? options.retryAt : undefined,
        };
        setQuota((previous) => {
          const existing = previous[cacheKey];
          if (
            options.mode === 'cached' &&
            existing?.observedAt &&
            state.observedAt &&
            Date.parse(existing.observedAt) > Date.parse(state.observedAt)
          )
            return previous;
          return { ...previous, [cacheKey]: state };
        });
        if (!enrich) void enrichQuotaInBackground(adapter, file, data, state, t, options);
      });
      observed = true;
      if (options.errorStatus && options.mode !== 'cached') {
        throw createStatusError(`HTTP ${options.errorStatus}`, options.errorStatus);
      }
    } catch (error: unknown) {
      if (options.mode === 'cached') return;
      const message = error instanceof Error ? error.message : t('common.unknown_error');
      if (!observed) {
        commitIfQuotaCacheCurrent(generation, () => {
          setQuota((previous) => ({
            ...previous,
            [cacheKey]: {
              ...adapter.buildErrorState(message, getStatusFromError(error)),
              retryAt: options.retryAt,
            },
          }));
        });
      }
      throw error;
    }
  };
  const request = execute().finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

import { quotaApi as apiCallApi } from '@/services/api/quota';
import { afterEach, expect, test } from 'bun:test';
import i18n from '@/i18n';
import type { AuthFileItem } from '@/types';
import { type ApiCallResult } from '@/services/api';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { XAI_CONFIG } from '@/features/quota/providers/xai/data';
import type { QuotaAdapter } from '@/features/quota/providers';
import { enrichQuotaInBackground } from '@/features/quota/quotaEnrichment';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { buildXaiBillingSummary } from '@/utils/quota';

const originalRequest = apiCallApi.read;
const file: AuthFileItem = { name: 'fixture.json', type: 'xai', auth_index: 'fixture' };
const key = getQuotaCacheKey(file);
const adapter = XAI_CONFIG as unknown as QuotaAdapter;
const result = (body: unknown, statusCode = 200): ApiCallResult => ({
  statusCode,
  body,
  bodyText: JSON.stringify(body),
  header: {},
});
const billing = () =>
  buildXaiBillingSummary({ monthlyLimit: { val: 15000 }, used: { val: 1500 } })!;
const current = () => useQuotaStore.getState().xaiQuota[key];
const deferred = () => {
  let resolve!: (value: ApiCallResult) => void;
  const promise = new Promise<ApiCallResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const beginEnrichment = () => {
  const data = billing();
  const state = XAI_CONFIG.buildSuccessState(data);
  useQuotaStore.getState().setXaiQuota({ [key]: state });
  const pending = enrichQuotaInBackground(adapter, file, data, state, i18n.t);
  return { data, state, pending };
};

afterEach(() => {
  apiCallApi.read = originalRequest;
  useQuotaStore.getState().clearQuotaCache();
});

test('commits quota before requesting optional plan and updates it later', async () => {
  const gate = deferred();
  const urls: string[] = [];
  apiCallApi.read = async (_authIndex, resource) => {
    urls.push(resource);
    if (resource === 'user' || resource === 'settings') {
      expect(current()?.status).toBe('success');
      return gate.promise;
    }
    return result({ config: { monthlyLimit: { val: 15000 }, used: { val: 1500 } } });
  };
  const data = await XAI_CONFIG.fetchQuota(file, i18n.t);
  expect(urls).toHaveLength(2);
  expect(urls).not.toContain('user');
  const state = XAI_CONFIG.buildSuccessState(data);
  useQuotaStore.getState().setXaiQuota({ [key]: state });
  const pending = enrichQuotaInBackground(adapter, file, data, state, i18n.t);
  expect(current()).toBe(state);
  expect(current().billing?.planLabel).toBeUndefined();
  gate.resolve(result({ subscription_tier_display: 'SuperGrok Heavy' }));
  await pending;
  expect(current().billing).toMatchObject({
    ...data,
    planLabel: 'SuperGrok Heavy',
    planTier: 'elite',
  });
});

for (const failure of ['network', 'http', 'malformed'] as const) {
  test(`optional ${failure} failure preserves the exact original quota and fallback`, async () => {
    apiCallApi.read = async () => {
      if (failure === 'network') throw new Error('unavailable');
      return failure === 'http' ? result({}, 503) : result('not-json');
    };
    const { state, pending } = beginEnrichment();
    await pending;
    expect(current()).toBe(state);
  });
}

test('uses user tier when settings fails', async () => {
  apiCallApi.read = async (_authIndex, resource) => {
    if (resource === 'settings') throw new Error('unavailable');
    return result({ subscriptionTier: 'SuperGrok' });
  };
  const { pending } = beginEnrichment();
  await pending;
  expect(current().billing).toMatchObject({ planLabel: 'SuperGrok', planTier: 'premium' });
});

for (const change of ['session', 'file', 'new-result', 'refresh'] as const) {
  test(`late subscription cannot overwrite ${change}`, async () => {
    const gate = deferred();
    apiCallApi.read = async () => gate.promise;
    const { pending } = beginEnrichment();
    if (change === 'session') useQuotaStore.getState().clearQuotaCache();
    if (change === 'file') useQuotaStore.getState().clearQuotaCache([file.name]);
    if (change === 'new-result') {
      useQuotaStore.getState().setXaiQuota({ [key]: XAI_CONFIG.buildSuccessState(billing()) });
    }
    if (change === 'refresh') {
      useQuotaStore.getState().setXaiQuota({ [key]: XAI_CONFIG.buildLoadingState() });
    }
    const expected = current();
    gate.resolve(result({ subscription_tier_display: 'SuperGrok Heavy' }));
    await pending;
    expect(current()).toBe(expected);
  });
}

test('unrelated file invalidation does not discard a valid subscription', async () => {
  const gate = deferred();
  apiCallApi.read = async () => gate.promise;
  const { pending } = beginEnrichment();
  useQuotaStore.getState().clearQuotaCache(['other.json']);
  gate.resolve(result({ subscription_tier_display: 'SuperGrok Heavy' }));
  await pending;
  expect(current().billing?.planLabel).toBe('SuperGrok Heavy');
});

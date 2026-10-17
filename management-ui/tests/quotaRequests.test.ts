import { afterEach, expect, spyOn, test } from 'bun:test';
import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import { loadQuotaEntry } from '@/features/quota/quotaRequests';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCacheKey } from '@/utils/quota/identity';

afterEach(() => useQuotaStore.getState().clearQuotaCache());
const file = { name: 'codex.json', type: 'codex', authIndex: 'fixture' };
const payload = { rate_limit: { primary_window: { used_percent: 25, reset_after_seconds: 60 } } };
const observedAt = '2026-10-17T12:00:00Z';

test('restores server timestamps and absolute reset instants, then retains them through a failed refresh', async () => {
  const get = spyOn(apiClient, 'get').mockImplementation(async (_path, config) => {
    const resource = (config?.params as { resource: string }).resource;
    return {
      status_code: 200,
      body: resource === 'usage' ? payload : { credits: [] },
      observed_at: observedAt,
      stale: true,
    };
  });
  const post = spyOn(apiClient, 'post').mockRejectedValue(new Error('offline'));
  try {
    await loadQuotaEntry(file, QUOTA_ADAPTERS.codex, i18n.t, { mode: 'cached' });
    const cached = useQuotaStore.getState().codexQuota[file.name];
    expect(cached.observedAt).toBe(observedAt);
    expect(cached.windows[0].resetAtMs).toBe(Date.parse(observedAt) + 60_000);
    const pending = loadQuotaEntry(file, QUOTA_ADAPTERS.codex, i18n.t, { mode: 'refresh' });
    expect(useQuotaStore.getState().codexQuota[file.name].windows).toBe(cached.windows);
    await expect(pending).rejects.toThrow('offline');
    expect(useQuotaStore.getState().codexQuota[file.name]).toMatchObject({
      status: 'error',
      hasData: true,
      observedAt,
    });
    expect(useQuotaStore.getState().codexQuota[file.name].windows).toBe(cached.windows);
  } finally {
    get.mockRestore();
    post.mockRestore();
  }
});

test('page and card share pending work and an old session cannot commit after reconnect', async () => {
  let resolve!: (value: unknown) => void;
  const response = new Promise((done) => {
    resolve = done;
  });
  const post = spyOn(apiClient, 'post').mockImplementation(async (_path, input) =>
    (input as { resource: string }).resource === 'usage'
      ? response
      : { status_code: 200, body: { credits: [] } }
  );
  try {
    const first = loadQuotaEntry(file, QUOTA_ADAPTERS.codex, i18n.t, { mode: 'refresh' });
    const second = loadQuotaEntry(file, QUOTA_ADAPTERS.codex, i18n.t, { mode: 'refresh' });
    expect(first).toBe(second);
    useQuotaStore.getState().clearQuotaCache();
    resolve({ status_code: 200, body: payload, observed_at: observedAt });
    await Promise.all([first, second]);
    expect(useQuotaStore.getState().codexQuota[file.name]).toBeUndefined();
    expect(
      post.mock.calls.filter((call) => (call[1] as { resource: string }).resource === 'usage')
    ).toHaveLength(1);
  } finally {
    post.mockRestore();
  }
});

test('replacement account identity changes the UI key even when the filename is reused', () => {
  const first = getQuotaCacheKey({ ...file, quota_identity: 'account-a' });
  const second = getQuotaCacheKey({ ...file, quota_identity: 'account-b' });
  expect(first).not.toBe(second);
});

test('an embedded provider error displays the saved snapshot and reports a failed refresh', async () => {
  const post = spyOn(apiClient, 'post').mockImplementation(async (_path, input) => ({
    status_code: 200,
    body: (input as { resource: string }).resource === 'usage' ? payload : { credits: [] },
    observed_at: observedAt,
    stale: true,
    error_status: (input as { resource: string }).resource === 'usage' ? 429 : 0,
  }));
  try {
    await expect(
      loadQuotaEntry(file, QUOTA_ADAPTERS.codex, i18n.t, { mode: 'refresh' })
    ).rejects.toThrow('HTTP 429');
    const state = useQuotaStore.getState().codexQuota[file.name];
    expect(state).toMatchObject({
      status: 'error',
      hasData: true,
      stale: true,
      observedAt,
      errorStatus: 429,
    });
    expect(state.windows[0].usedPercent).toBe(25);
  } finally {
    post.mockRestore();
  }
});

test('a saved xAI quota still restores optional plan metadata when the latest quota refresh failed', async () => {
  const post = spyOn(apiClient, 'post').mockImplementation(async (_path, input) => {
    const resource = (input as { resource: string }).resource;
    const primary = resource === 'weekly' || resource === 'monthly';
    return {
      status_code: 200,
      body: primary
        ? { config: { monthlyLimit: { val: 10000 }, used: { val: 2500 } } }
        : { subscription_tier_display: 'SuperGrok Heavy' },
      observed_at: observedAt,
      stale: primary,
      error_status: primary ? 503 : 0,
    };
  });
  try {
    await expect(
      loadQuotaEntry({ ...file, type: 'xai' }, QUOTA_ADAPTERS.xai, i18n.t, { mode: 'refresh' })
    ).rejects.toThrow('HTTP 503');
    for (let index = 0; index < 15; index++) await Promise.resolve();
    const state = useQuotaStore.getState().xaiQuota[file.name];
    expect(state.billing?.planLabel).toBe('SuperGrok Heavy');
    expect(state).toMatchObject({ status: 'error', errorStatus: 503, hasData: true, observedAt });
  } finally {
    post.mockRestore();
  }
});

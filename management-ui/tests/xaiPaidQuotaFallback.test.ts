import { describe, expect, spyOn, test } from 'bun:test';
import { XAI_CONFIG } from '@/features/quota/providers/xai/data';
import { apiClient } from '@/services/api/client';
import { apiCallApi } from '@/services/api/apiCall';
import i18n from '@/i18n';

describe('read-only xAI quota', () => {
  for (const automatic of [true, false]) {
    test(`billing failure never runs paid inference (automatic=${automatic})`, async () => {
      const raw = spyOn(apiCallApi, 'request');
      const post = spyOn(apiClient, 'post').mockResolvedValue({ status_code: 403, body: null });
      try {
        await expect(
          XAI_CONFIG.fetchQuota(
            { name: 'paid.json', type: 'xai', authIndex: 'xai-1', using_api: true, prefix: 'paid' },
            i18n.t,
            { automatic }
          )
        ).rejects.toThrow();
        expect(post.mock.calls.map((call) => call[0])).toEqual(
          Array(2).fill('/credentials/quota/refresh')
        );
        expect(
          post.mock.calls.map((call) => (call[1] as { resource: string }).resource).sort()
        ).toEqual(['monthly', 'weekly']);
        expect(raw).not.toHaveBeenCalled();
        expect(JSON.stringify(post.mock.calls)).not.toContain('chat/completions');
      } finally {
        raw.mockRestore();
        post.mockRestore();
      }
    });
  }
  test('merges the two billing windows without a health probe', async () => {
    const post = spyOn(apiClient, 'post').mockImplementation(async (_path, input) => ({
      status_code: 200,
      body: {
        config:
          (input as { resource: string }).resource === 'weekly'
            ? { currentPeriod: { type: 'weekly' }, creditUsagePercent: 25 }
            : { monthlyLimit: { val: 10000 }, used: { val: 2500 } },
      },
    }));
    try {
      const data = await XAI_CONFIG.fetchQuota({ name: 'xai.json', authIndex: 'xai-1' }, i18n.t);
      expect(data).toMatchObject({ mode: 'billing', usagePercent: 25, monthlyLimitCents: 10000 });
      expect(post).toHaveBeenCalledTimes(2);
    } finally {
      post.mockRestore();
    }
  });
});

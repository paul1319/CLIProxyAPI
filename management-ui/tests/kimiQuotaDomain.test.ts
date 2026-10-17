import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import i18n from '@/i18n';
import { KIMI_CONFIG } from '@/features/quota/providers/kimi/data';
import { authFilesApi } from '@/services/api';
import { quotaApi } from '@/services/api/quota';
import { useQuotaStore } from '@/stores/useQuotaStore';

const file = { name: 'kimi.json', type: 'kimi-ai', authIndex: 'kimi-identity' };
const response = {
  statusCode: 200,
  body: { usage: { used: 10, limit: 100 } },
  bodyText: '',
  header: {},
};
afterEach(() => useQuotaStore.getState().clearQuotaCache());

describe('Kimi server-owned quota identity', () => {
  test('lets the server resolve the effective domain without downloading credentials', async () => {
    const download = spyOn(authFilesApi, 'downloadText');
    const read = spyOn(quotaApi, 'read').mockResolvedValue(response);
    try {
      const rows = await KIMI_CONFIG.fetchQuota(file, i18n.t);
      expect(read).toHaveBeenCalledWith('kimi-identity', 'usage', {});
      expect(download).not.toHaveBeenCalled();
      expect(rows[0]).toMatchObject({ used: 10, limit: 100 });
    } finally {
      read.mockRestore();
      download.mockRestore();
    }
  });
  for (const scope of ['session', 'file', 'unrelated'] as const) {
    test(`guards ${scope} invalidation while reading`, async () => {
      const read = spyOn(quotaApi, 'read').mockImplementation(async () => {
        useQuotaStore
          .getState()
          .clearQuotaCache(
            scope === 'session' ? undefined : [scope === 'file' ? file.name : 'other.json']
          );
        return response;
      });
      try {
        if (scope === 'unrelated') await KIMI_CONFIG.fetchQuota(file, i18n.t);
        else
          await expect(KIMI_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow(
            i18n.t('kimi_quota.stale_request')
          );
      } finally {
        read.mockRestore();
      }
    });
  }
});

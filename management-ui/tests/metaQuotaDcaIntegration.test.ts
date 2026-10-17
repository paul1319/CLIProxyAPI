import { expect, spyOn, test } from 'bun:test';
import { META_CONFIG } from '@/features/quota/providers/meta/data';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import { metaQuotaResponse } from './fixtures/metaQuota';
import i18n from '@/i18n';

for (const hasUsage of [true, false]) {
  test(`Meta quota snapshot with ${hasUsage ? 'populated' : 'missing'} usage never downloads a DCA token`, async () => {
    const download = spyOn(authFilesApi, 'downloadText');
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      status_code: 200,
      body: {
        ...metaQuotaResponse,
        subs_usage: hasUsage ? metaQuotaResponse.subs_usage : undefined,
      },
    });
    try {
      const data = await META_CONFIG.fetchQuota(
        { name: 'meta.json', authIndex: 'fixture-index' },
        i18n.t
      );
      expect(post).toHaveBeenCalledWith('/credentials/quota/refresh', {
        auth_index: 'fixture-index',
        resource: 'usage',
        force: false,
      });
      expect(download).not.toHaveBeenCalled();
      const state = META_CONFIG.buildSuccessState(data);
      expect(state.data?.windows.map((window) => window.usedPercent)).toEqual(
        hasUsage ? [2, 0] : [null, null]
      );
      for (const secret of ['dca:', 'LLM|', 'fixture@example.invalid', 'Fixture User'])
        expect(JSON.stringify(state)).not.toContain(secret);
    } finally {
      download.mockRestore();
      post.mockRestore();
    }
  });
}

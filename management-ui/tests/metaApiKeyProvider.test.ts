import { describe, expect, test } from 'bun:test';
import { normalizeConfigResponse } from '../src/services/api/transformers';

describe('Meta Muse API key provider', () => {
  test('normalizes the backend meta-api-key contract', () => {
    const config = normalizeConfigResponse({
      'api-keys': {
        meta: [
          {
            name: 'meta-1',
            'base-url': 'https://api.meta.ai/v1',
            keys: [
              {
                'api-key': 'meta-secret',
                priority: 7,
                weight: 3,
                prefix: 'muse',
                'proxy-url': 'socks5://proxy.example:1080',
                headers: { 'X-Custom': 'value' },
                models: [{ name: 'muse-spark-1.3', alias: 'muse-latest' }],
                'excluded-models': ['muse-spark-1.1'],
                'disable-cooling': true,
                'auth-index': 'meta:apikey:1',
              },
            ],
          },
        ],
      },
    });

    expect(config.metaApiKeys).toMatchObject([
      {
        apiKey: 'meta-secret',
        priority: 7,
        weight: 3,
        prefix: 'muse',
        baseUrl: 'https://api.meta.ai/v1',
        proxyUrl: 'socks5://proxy.example:1080',
        headers: { 'X-Custom': 'value' },
        models: [{ name: 'muse-spark-1.3', alias: 'muse-latest' }],
        excludedModels: ['muse-spark-1.1'],
        disableCooling: true,
        authIndex: 'meta:apikey:1',
      },
    ]);
  });
});

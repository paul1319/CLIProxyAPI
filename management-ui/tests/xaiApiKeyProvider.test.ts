import { describe, expect, test } from 'bun:test';
import { normalizeConfigResponse } from '../src/services/api/transformers';

describe('xAI API key provider', () => {
  test('normalizes the backend xai-api-key contract', () => {
    const config = normalizeConfigResponse({
      'api-keys': {
        xai: [
          {
            name: 'xai-1',
            'base-url': 'https://api.x.ai/v1',
            keys: [
              {
                'api-key': 'xai-secret',
                priority: 7,
                prefix: 'team-xai',
                websockets: true,
                'proxy-url': 'http://proxy.local',
                headers: { 'X-Custom': 'value' },
                models: [{ name: 'grok-4.5', alias: 'grok-latest' }],
                'excluded-models': ['grok-3-*'],
                'disable-cooling': true,
                'auth-index': 'xai:apikey:1',
              },
            ],
          },
        ],
      },
    });

    expect(config.xaiApiKeys).toMatchObject([
      {
        apiKey: 'xai-secret',
        priority: 7,
        prefix: 'team-xai',
        baseUrl: 'https://api.x.ai/v1',
        websockets: true,
        proxyUrl: 'http://proxy.local',
        headers: { 'X-Custom': 'value' },
        models: [{ name: 'grok-4.5', alias: 'grok-latest' }],
        excludedModels: ['grok-3-*'],
        disableCooling: true,
        authIndex: 'xai:apikey:1',
      },
    ]);
  });
});

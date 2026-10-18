import { describe, expect, test } from 'bun:test';
import { normalizeConfigResponse } from '../src/services/api/transformers';

describe('Interactions API key provider', () => {
  test('normalizes the backend interactions contract', () => {
    const config = normalizeConfigResponse({
      'api-keys': {
        interactions: [
          {
            name: 'interactions-1',
            'base-url': 'https://generativelanguage.googleapis.com',
            keys: [
              {
                'api-key': 'interactions-secret',
                priority: 8,
                weight: 3,
                prefix: 'native',
                'proxy-url': 'direct',
                headers: { 'X-Custom': 'value' },
                models: [
                  {
                    name: 'gemini-3.1-flash-lite',
                    alias: 'native-flash',
                    thinking: { levels: ['low', 'medium', 'high'] },
                  },
                ],
                'excluded-models': ['gemini-2.5-*'],
                'disable-cooling': true,
                'auth-index': 'gemini-interactions:apikey:1',
              },
            ],
          },
        ],
      },
    });

    expect(config.interactionsApiKeys).toMatchObject([
      {
        apiKey: 'interactions-secret',
        priority: 8,
        weight: 3,
        prefix: 'native',
        baseUrl: 'https://generativelanguage.googleapis.com',
        proxyUrl: 'direct',
        headers: { 'X-Custom': 'value' },
        models: [
          {
            name: 'gemini-3.1-flash-lite',
            alias: 'native-flash',
            thinking: { levels: ['low', 'medium', 'high'] },
          },
        ],
        excludedModels: ['gemini-2.5-*'],
        disableCooling: true,
        authIndex: 'gemini-interactions:apikey:1',
      },
    ]);
  });
});

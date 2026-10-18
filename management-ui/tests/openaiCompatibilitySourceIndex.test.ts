import { describe, expect, test } from 'bun:test';
import { normalizeConfigResponse } from '../src/services/api/transformers';

describe('openai-compatibility normalization', () => {
  test('keeps backend indexes when normalization filters an unnamed item', () => {
    const config = normalizeConfigResponse({
      'api-keys': {
        'openai-compatibility': [
          { 'base-url': 'https://invalid.example.com/v1', keys: [] },
          {
            name: 'gateway',
            'base-url': 'https://a.example.com/v1',
            keys: [{ 'api-key': 'key-a' }],
          },
          {
            name: 'gateway',
            'base-url': 'https://b.example.com/v1',
            keys: [{ 'api-key': 'key-b' }],
          },
        ],
      },
    });

    expect(config.openaiCompatibility?.map((item) => item.sourceIndex)).toEqual([1, 2]);
  });
});

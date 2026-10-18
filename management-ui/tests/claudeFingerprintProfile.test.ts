import { describe, expect, test } from 'bun:test';
import { normalizeConfigResponse } from '../src/services/api/transformers';

describe('Claude fingerprint profile', () => {
  test('normalizes the backend fingerprint-profile field', () => {
    const config = normalizeConfigResponse({
      'api-keys': {
        claude: [
          {
            name: 'claude-1',
            'base-url': 'https://api.anthropic.com',
            keys: [{ 'api-key': 'claude-secret', 'fingerprint-profile': 'claude-code-cli' }],
          },
        ],
      },
    });

    expect(config.claudeApiKeys).toMatchObject([
      {
        apiKey: 'claude-secret',
        baseUrl: 'https://api.anthropic.com',
        fingerprintProfile: 'claude-code-cli',
      },
    ]);
  });
});

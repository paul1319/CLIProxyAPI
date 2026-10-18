import { describe, expect, test } from 'bun:test';
import { normalizeConfigResponse } from '../src/services/api/transformers';

describe('v8 provider groups', () => {
  test('reads only the v8 tree and retains empty groups and exact source snapshots', () => {
    const group = {
      name: 'team',
      'base-url': 'https://example.invalid',
      priority: 8,
      headers: { A: 'group' },
      keys: [
        { 'api-key': 'fixture-a', priority: null, headers: null },
        { 'api-key': 'fixture-b', priority: 0, headers: {} },
      ],
    };
    const config = normalizeConfigResponse({
      'api-keys': { codex: [group, { name: 'empty', keys: [] }] },
      access: { 'api-keys': ['client-fixture'] },
      observability: { logs: { debug: true } },
      requests: { 'proxy-url': 'direct' },
      routing: { retry: { 'request-retry': 4 } },
      'codex-api-key': [{ 'api-key': 'must-not-read' }],
    });
    expect(config.codexApiKeys).toHaveLength(2);
    expect(config.codexApiKeys?.map((r) => r.priority)).toEqual([8, 0]);
    expect(config.codexApiKeys?.[0].source).toMatchObject({ groupIndex: 0, keyIndex: 0, group });
    expect(config.providerGroups?.codex).toHaveLength(2);
    expect(config.apiKeys).toEqual(['client-fixture']);
    expect(config.debug).toBe(true);
    expect(config.requestRetry).toBe(4);
    expect(config.proxyUrl).toBe('direct');
    expect(
      normalizeConfigResponse({ 'codex-api-key': [{ 'api-key': 'old' }] }).codexApiKeys
    ).toEqual([]);
  });
});

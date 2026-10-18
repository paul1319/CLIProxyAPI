import { expect, test } from 'bun:test';
import { normalizeProviderGroups } from '@/services/api/transformers';
import type { ProviderKeyConfig } from '@/types';

const rawModel = {
  name: 'fixture-model',
  alias: 'fixture-alias',
  'display-name': 'Fixture Model',
  'max-context-length': 32768,
  'force-mapping': true,
  'is-compat': true,
  'support-configuration-update': false,
  thinking: {
    min: 0,
    max: 8192,
    'zero-allowed': false,
    'dynamic-allowed': true,
    levels: ['low', 'high'],
  },
};
test('normalizes model attributes and converts v8 YAML thinking flags', () => {
  const config = normalizeProviderGroups([
    { name: 'fixture', keys: [{ 'api-key': 'fixture-key', models: [rawModel] }] },
  ])[0] as ProviderKeyConfig;
  expect(config.models?.[0]).toMatchObject({
    displayName: 'Fixture Model',
    maxContextLength: 32768,
    forceMapping: true,
    isCompat: true,
    supportConfigurationUpdate: false,
    thinking: {
      min: 0,
      max: 8192,
      zero_allowed: false,
      dynamic_allowed: true,
      levels: ['low', 'high'],
    },
  });
  expect(config.models?.[0].thinking).not.toHaveProperty('zero-allowed');
});

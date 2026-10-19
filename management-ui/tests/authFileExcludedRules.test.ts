import { describe, expect, test } from 'bun:test';
import {
  readAuthFileExcludedModels,
  resolveAuthFileExcludedRules,
} from '../src/features/authFiles/constants';

describe('readAuthFileExcludedModels', () => {
  test('reads the canonical field before the legacy alias', () => {
    expect(
      readAuthFileExcludedModels({
        excluded_models: [' gpt-5* ', 'GPT-5*'],
        'excluded-models': ['x'],
      })
    ).toEqual(['gpt-5*']);
    expect(readAuthFileExcludedModels({ 'excluded-models': ['legacy-*'] })).toEqual(['legacy-*']);
  });

  test('ignores non-array values and non-string entries', () => {
    expect(readAuthFileExcludedModels({ excluded_models: 'a,b' })).toEqual([]);
    expect(readAuthFileExcludedModels({ excluded_models: null })).toEqual([]);
    expect(readAuthFileExcludedModels({ excluded_models: ['ok', 3, ''] })).toEqual(['ok']);
  });
});

describe('resolveAuthFileExcludedRules', () => {
  const providerRules = { codex: ['global-*'] };

  test('a credential list replaces the provider rules instead of merging', () => {
    expect(resolveAuthFileExcludedRules(['local-*'], 'codex', providerRules)).toEqual(['local-*']);
  });

  test('an empty credential list inherits the provider rules', () => {
    expect(resolveAuthFileExcludedRules([], 'codex', providerRules)).toEqual(['global-*']);
    expect(resolveAuthFileExcludedRules([], 'claude', providerRules)).toEqual([]);
  });
});

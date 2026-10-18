import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  countAuthFileHealth,
  filterAuthFiles,
  getAuthFileHealth,
  getSelectableNames,
  getSelectedMatchingNames,
  matchesStatusFilter,
} from '../src/features/authFiles/logic';
import type { AuthFileItem } from '../src/types';

const file = (overrides: Partial<AuthFileItem> & { name: string }): AuthFileItem => ({
  type: 'codex',
  ...overrides,
});

const pool: AuthFileItem[] = [
  file({ name: 'codex-alex.json', email: 'alex@example.com' }),
  file({ name: 'codex-sam.json', email: 'sam@example.com', disabled: true }),
  file({
    name: 'claude-jordan.json',
    type: 'claude',
    email: 'jordan@example.com',
    status: 'error',
    statusMessage: 'refresh token revoked (401)',
  }),
  file({
    name: 'claude-riley.json',
    type: 'claude',
    email: 'riley@example.com',
    cooldownSnapshot: {
      receivedAtMs: Date.now(),
      records: [
        {
          scope: 'credential',
          reason: 'quota',
          retryAt: '2026-10-18T10:00:00Z',
          remainingSeconds: 600,
        },
      ],
    },
  }),
  file({ name: 'virtual-channel', type: 'aistudio', runtimeOnly: true }),
];

describe('credential bulk actions respect the full visible filter', () => {
  test('search narrows the matching set used by "select all matching"', () => {
    const matching = filterAuthFiles(pool, { provider: 'all', status: 'all', search: 'alex' });
    expect(matching.map((item) => item.name)).toEqual(['codex-alex.json']);
    expect(getSelectableNames(matching)).toEqual(['codex-alex.json']);
  });

  test('a selection made before searching cannot delete rows the search hides', () => {
    // Regression: "Delete all" used to call the server-wide deleteAll() while a search was active.
    const selected = new Set(pool.map((item) => item.name));
    const matching = filterAuthFiles(pool, { provider: 'all', status: 'all', search: 'alex' });
    expect(getSelectedMatchingNames(selected, matching)).toEqual(['codex-alex.json']);
  });

  test('provider, status and search combine; runtime-only credentials are never targets', () => {
    const claudeProblems = filterAuthFiles(pool, {
      provider: 'claude',
      status: 'problem',
      search: '',
    });
    expect(claudeProblems.map((item) => item.name)).toEqual([
      'claude-jordan.json',
      'claude-riley.json',
    ]);
    const everything = filterAuthFiles(pool, { provider: 'all', status: 'all', search: '' });
    expect(getSelectableNames(everything)).not.toContain('virtual-channel');
    expect(getSelectedMatchingNames(new Set(['virtual-channel']), everything)).toEqual([]);
  });

  test('wildcard search uses the same pipeline', () => {
    const matching = filterAuthFiles(pool, { provider: 'all', status: 'all', search: 'claude-*' });
    expect(matching.map((item) => item.name)).toEqual(['claude-jordan.json', 'claude-riley.json']);
  });

  test('the page wires bulk delete to the visible selection, never to deleteAll()', () => {
    const page = readFileSync('src/features/authFiles/AuthFilesPage.tsx', 'utf8');
    const hook = readFileSync('src/features/authFiles/hooks/useAuthFilesData.ts', 'utf8');
    expect(page).toContain('getSelectedMatchingNames(selectedFiles, sorted)');
    expect(page).toContain('onDelete={() => batchDelete(selectedNames)}');
    expect(page).toContain('onSelectAllMatching={() => selectAllVisible(sorted)}');
    expect(page).not.toContain('deleteAll');
    expect(hook).not.toContain('deleteAll');
    expect(hook).not.toContain('handleDeleteAll');
  });
});

describe('credential health segments', () => {
  test('serving, problem and disabled partition the pool', () => {
    const counts = Object.fromEntries(
      (['all', 'enabled', 'problem', 'disabled'] as const).map((mode) => [
        mode,
        pool.filter((item) => matchesStatusFilter(item, mode)).length,
      ])
    );
    expect(counts.enabled + counts.problem + counts.disabled).toBe(counts.all);
    expect(counts).toEqual({ all: 5, enabled: 2, problem: 2, disabled: 1 });
  });

  test('health matches the pool rail classification', () => {
    expect(pool.map(getAuthFileHealth)).toEqual([
      'serving',
      'disabled',
      'failing',
      'cooling',
      'serving',
    ]);
    expect(countAuthFileHealth(pool)).toEqual({
      total: 5,
      serving: 2,
      cooling: 1,
      failing: 1,
      disabled: 1,
    });
  });
});

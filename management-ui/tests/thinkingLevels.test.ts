import { describe, expect, test } from 'bun:test';
import { THINKING_LEVELS } from '../src/features/providers/thinkingLevels';

describe('standard thinking level selector', () => {
  test('only exposes levels recognized by the backend', () => {
    expect(THINKING_LEVELS).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'auto',
    ]);
  });
});

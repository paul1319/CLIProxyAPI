import { describe, expect, test } from 'bun:test';
import { getVisualConfigValidationErrors, parseRoutingStrategy } from '@/hooks/useVisualConfig';
import { DEFAULT_VISUAL_VALUES } from '@/types/visualConfig';
import { runVisualConfig } from './helpers/visualConfig';

describe('reset-first routing', () => {
  test('accepts reset-first aliases', () => {
    expect(parseRoutingStrategy('reset-first')).toBe('reset-first');
    expect(parseRoutingStrategy('RF')).toBe('reset-first');
  });

  test('validates the five-hour threshold only while reset-first is selected', () => {
    for (const threshold of ['0', '101', 'abc']) {
      const inactive = getVisualConfigValidationErrors({
        ...DEFAULT_VISUAL_VALUES,
        routingStrategy: 'round-robin',
        routingResetFirstMaxFiveHour: threshold,
      });
      expect(inactive.routingResetFirstMaxFiveHour).toBeUndefined();
      const active = getVisualConfigValidationErrors({
        ...DEFAULT_VISUAL_VALUES,
        routingStrategy: 'reset-first',
        routingResetFirstMaxFiveHour: threshold,
      });
      expect(active.routingResetFirstMaxFiveHour).toBe('integer_range_1_100');
    }
    const valid = getVisualConfigValidationErrors({
      ...DEFAULT_VISUAL_VALUES,
      routingStrategy: 'reset-first',
      routingResetFirstMaxFiveHour: '90',
    });
    expect(valid.routingResetFirstMaxFiveHour).toBeUndefined();
  });

  test('clearing the threshold removes the empty reset-first section', () => {
    const yaml =
      'config-version: 8\nrouting:\n  strategy: reset-first\n  reset-first:\n    max-five-hour-utilization: 70\n';
    const config = runVisualConfig(yaml, [{ routingResetFirstMaxFiveHour: '' }]);
    expect(config.applyVisualChangesToYaml(yaml)).not.toContain('reset-first:\n');
    expect(config.applyVisualChangesToYaml(yaml)).toContain('strategy: reset-first');
  });
});

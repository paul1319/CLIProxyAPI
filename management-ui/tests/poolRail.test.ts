import { describe, expect, test } from 'bun:test';
import {
  getCredentialLampState,
  getPoolLampState,
  summarizePool,
} from '@/components/layout/poolRail';
import type { AuthFileItem } from '@/types';

const file = (overrides: Partial<AuthFileItem>): AuthFileItem => ({ name: 'a.json', ...overrides });

describe('pool rail', () => {
  test('maps credential health to lamp states', () => {
    expect(getCredentialLampState(file({}))).toBe('ok');
    expect(getCredentialLampState(file({ disabled: true, unavailable: true }))).toBe('idle');
    expect(getCredentialLampState(file({ unavailable: true }))).toBe('fault');
    expect(
      getCredentialLampState(
        file({
          cooldownSnapshot: {
            receivedAtMs: 0,
            records: [
              {
                scope: 'credential',
                reason: 'quota',
                retryAt: '2026-01-01T00:00:00Z',
                remainingSeconds: 60,
              },
            ],
          },
        })
      )
    ).toBe('warn');
  });

  test('model-scoped cooldowns keep the credential serving', () => {
    expect(
      getCredentialLampState(
        file({
          cooldownSnapshot: {
            receivedAtMs: 0,
            records: [
              {
                scope: 'model',
                modelKey: 'gpt-5',
                reason: 'quota',
                retryAt: '2026-01-01T00:00:00Z',
                remainingSeconds: 60,
              },
            ],
          },
        })
      )
    ).toBe('ok');
  });

  test('summarizes and orders lamps like a fill gauge', () => {
    const summary = summarizePool([
      file({ name: 'ok.json' }),
      file({ name: 'off.json', disabled: true }),
      file({ name: 'bad.json', unavailable: true }),
    ]);
    expect(summary).toMatchObject({ total: 3, serving: 1, failing: 1, disabled: 1, cooling: 0 });
    expect(summary.lamps.map((lamp) => lamp.state)).toEqual(['ok', 'fault', 'idle']);
    expect(getPoolLampState(summary)).toBe('fault');
    expect(getPoolLampState(summarizePool([]))).toBe('idle');
  });
});

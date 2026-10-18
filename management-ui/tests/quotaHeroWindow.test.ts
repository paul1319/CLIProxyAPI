/**
 * Which window becomes a card's focal figure, and how accounts roll up into
 * the pool summary.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import {
  buildAccountOverview,
  pickHeroLimit,
  resolveAvailability,
  type AccountLimit,
} from '@/features/quota/accountCardModel';
import {
  buildGroupSummary,
  buildPoolSummary,
  snapshotAccount,
  type AccountSnapshotInput,
} from '@/features/quota/poolSummary';
import { describeQuotaError, formatCompactDuration } from '@/features/quota/format';
import { orderWindowRows, toneForPercent } from '@/features/quota/windowRows';
import { QuotaMeter } from '@/features/quota/components/QuotaMeter';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { LOW_REMAINING_FRACTION, toneForRemaining } from '@/components/ui/meterTone';
import type { LampState } from '@/components/ui/StatusLamp';
import { getQuotaCardTitle } from '@/utils/quota/identity';
import type { AntigravityQuotaState, ClaudeQuotaState, CodexQuotaState } from '@/types';

const NOW = Date.UTC(2026, 9, 18, 12);
const HOUR = 3_600_000;
const LAMP_ORDER: LampState[] = ['ok', 'warn', 'fault', 'idle'];

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const limit = (id: string, remaining: number | null, extra: Partial<AccountLimit> = {}) =>
  ({ id, label: id, remaining, resetAtMs: null, scope: 'gating', ...extra }) as AccountLimit;

describe('hero window selection', () => {
  test('Codex: model-scoped code review never outranks the 5-hour and weekly windows', () => {
    const overview = buildAccountOverview(
      'codex',
      {
        status: 'success',
        windows: [
          { id: 'five-hour', label: '5h', usedPercent: 40, resetLabel: '-', resetAtMs: NOW + HOUR },
          {
            id: 'weekly',
            label: 'wk',
            usedPercent: 70,
            resetLabel: '-',
            resetAtMs: NOW + 72 * HOUR,
          },
          { id: 'code-review-weekly', label: 'cr', usedPercent: 99, resetLabel: '-' },
          { id: 'spark-five-hour-0', label: 'spark', usedPercent: 100, resetLabel: '-' },
        ],
      } as CodexQuotaState,
      i18n.t
    );
    expect(overview.limits.map((item) => item.scope)).toEqual([
      'gating',
      'gating',
      'scoped',
      'scoped',
    ]);
    expect(overview.heroLimitId).toBe('weekly');
    expect(overview.available).toBe(true);
  });

  test('Claude: Sonnet/Opus/Fable windows and extra usage are never the hero', () => {
    const overview = buildAccountOverview(
      'claude',
      {
        status: 'success',
        windows: [
          { id: 'five-hour', label: '5h', usedPercent: 10, resetLabel: '-' },
          { id: 'seven-day', label: '7d', usedPercent: 30, resetLabel: '-' },
          { id: 'seven-day-sonnet', label: 'sonnet', usedPercent: 100, resetLabel: '-' },
          { id: 'seven-day-fable', label: 'fable', usedPercent: 95, resetLabel: '-' },
        ],
        extraUsage: {
          isEnabled: true,
          monthlyLimit: 5000,
          usedCredits: 5000,
          utilization: 100,
          currency: 'USD',
          disabledReason: null,
          userDisabled: false,
          spendLimitReached: true,
        },
      } as ClaudeQuotaState,
      i18n.t
    );
    expect(overview.heroLimitId).toBe('seven-day');
    expect(overview.limits.find((item) => item.id === 'extra-usage')?.scope).toBe('spend');
    expect(overview.available).toBe(true);
    // An enabled cap is already its own row; no "Extra Usage: Enabled" note.
    expect(overview.notes.some((note) => note.includes('Enabled'))).toBe(false);
  });

  test('Antigravity: translated labels, model pools, and partial availability', () => {
    const overview = buildAccountOverview(
      'antigravity',
      {
        status: 'success',
        groups: [
          {
            id: 'gemini',
            label: 'Gemini Models',
            buckets: [
              { id: 'g5', label: '5 Hour Limit Remaining', window: '5h', remainingFraction: 0.8 },
              {
                id: 'gw',
                label: 'Weekly Limit Remaining',
                window: 'weekly',
                remainingFraction: 0.5,
              },
            ],
          },
          {
            id: 'claude',
            label: 'Claude and GPT Models',
            buckets: [
              {
                id: 'c5',
                label: '5 Hour Limit Remaining',
                remainingFraction: 0,
                resetAtMs: NOW + HOUR,
              },
            ],
          },
        ],
      } as AntigravityQuotaState,
      i18n.t
    );
    expect(overview.limits.map((item) => [item.pool, item.label])).toEqual([
      ['Gemini models', '5-hour limit'],
      ['Gemini models', 'Weekly limit'],
      ['Claude and GPT models', '5-hour limit'],
    ]);
    expect(overview.heroLimitId).toBe('claude:c5');
    // Gemini still serves, so the account is available even though one pool is empty.
    expect(overview.available).toBe(true);
  });

  test('exhausted ties pick the window that resets last; unknown values are skipped', () => {
    const hero = pickHeroLimit([
      limit('five-hour', 0, { resetAtMs: NOW + HOUR }),
      limit('weekly', 0, { resetAtMs: NOW + 50 * HOUR }),
      limit('unknown', null),
    ]);
    expect(hero?.id).toBe('weekly');
    expect(pickHeroLimit([limit('a', 50), limit('b', 50)])?.id).toBe('a');
    expect(pickHeroLimit([limit('scoped', 1, { scope: 'scoped' })])).toBeNull();
  });

  test('non-pooled accounts stop serving when any gating window is empty', () => {
    expect(resolveAvailability('codex', [limit('five-hour', 0), limit('weekly', 60)])).toBe(false);
    expect(resolveAvailability('codex', [limit('cr', 0, { scope: 'scoped' })])).toBeNull();
    expect(
      resolveAvailability('antigravity', [
        limit('a', 0, { pool: 'x' }),
        limit('b', 0, { pool: 'y' }),
      ])
    ).toBe(false);
  });
});

describe('pool summary', () => {
  const overviewOf = (limits: AccountLimit[], available: boolean | null, heroLimitId: string) => ({
    plan: null,
    credits: [],
    renewalAtMs: null,
    notes: [],
    limits,
    heroLimitId,
    available,
  });
  const input = (key: string, extra: Partial<AccountSnapshotInput>): AccountSnapshotInput => ({
    key,
    name: key,
    type: 'codex',
    overview: null,
    lamp: 'ok',
    failing: false,
    cooldownSeconds: 0,
    resets: null,
    ...extra,
  });

  const healthy = snapshotAccount(
    input('healthy', {
      overview: overviewOf([limit('h', 90, { resetAtMs: NOW + 2 * HOUR })], true, 'h'),
      resets: 2,
    })
  );
  const low = snapshotAccount(
    input('low', {
      overview: overviewOf([limit('l', 10, { resetAtMs: NOW + 3 * HOUR })], true, 'l'),
    })
  );
  const exhausted = snapshotAccount(
    input('exhausted', {
      overview: overviewOf([limit('e', 0, { resetAtMs: NOW + HOUR, label: '5-hour' })], false, 'e'),
    })
  );
  // Out of capacity *and* in a 429 routing cooldown (sam.rivera in the screenshots).
  const cooling = snapshotAccount(
    input('cooling', {
      overview: overviewOf([limit('c', 0, { resetAtMs: NOW + 4 * HOUR })], false, 'c'),
      lamp: 'warn',
      cooldownSeconds: 600,
    })
  );
  const failing = snapshotAccount(input('failing', { failing: true }));
  // Failing auth keeps its fault even when old data still shows capacity.
  const authFailing = snapshotAccount(
    input('authFailing', {
      overview: overviewOf([limit('a', 70)], true, 'a'),
      lamp: 'fault',
    })
  );
  // A failed refresh with retained data stays serving; only the card freshness turns red.
  const staleRead = snapshotAccount(
    input('staleRead', {
      overview: overviewOf([limit('s', 80)], true, 's'),
      failing: true,
    })
  );
  const disabled = snapshotAccount(input('disabled', { lamp: 'idle', failing: true }));
  const unknown = snapshotAccount(input('unknown', {}));
  const all = [
    unknown,
    disabled,
    failing,
    cooling,
    exhausted,
    authFailing,
    low,
    staleRead,
    healthy,
  ];

  test('one state per account, by precedence; recoverable constraints are warn, not fault', () => {
    expect(Object.fromEntries(all.map((item) => [item.key, [item.state, item.tone]]))).toEqual({
      healthy: ['available', 'ok'],
      staleRead: ['available', 'ok'],
      low: ['low', 'warn'],
      exhausted: ['exhausted', 'warn'],
      cooling: ['cooling', 'warn'],
      failing: ['failing', 'fault'],
      authFailing: ['failing', 'fault'],
      disabled: ['disabled', 'idle'],
      unknown: ['unknown', 'idle'],
    });
    // Full accounts never claim a recovery time; constrained ones do even while cooling down.
    expect(healthy.recoverAtMs).toBeNull();
    expect(cooling.recoverAtMs).toBe(NOW + 4 * HOUR);
  });

  test('counts are mutually exclusive and segments follow lamp order ok → warn → fault → idle', () => {
    const summary = buildPoolSummary(all, NOW);
    expect(summary).toMatchObject({
      total: 9,
      available: 3,
      low: 1,
      exhausted: 1,
      cooling: 1,
      failing: 2,
      resets: 2,
      observed: true,
    });
    // Serving (low included) plus the non-serving buckets and idle accounts add up to the pool.
    const idle = all.filter((item) => item.tone === 'idle').length;
    const notServing = summary.exhausted + summary.cooling + summary.failing + idle;
    expect(summary.available + notServing).toBe(summary.total);
    expect(summary.next).toMatchObject({ name: 'exhausted', label: '5-hour', atMs: NOW + HOUR });
    expect(summary.segments.map((item) => item.key)).toEqual([
      'staleRead',
      'healthy',
      'low',
      'exhausted',
      'cooling',
      'failing',
      'authFailing',
      'disabled',
      'unknown',
    ]);
    const tones = summary.segments.map((item) => item.tone);
    expect(tones).toEqual([...tones].sort((a, b) => LAMP_ORDER.indexOf(a) - LAMP_ORDER.indexOf(b)));
  });

  test('low uses the shared meter threshold', () => {
    const at = (remaining: number) =>
      snapshotAccount(input('x', { overview: overviewOf([limit('x', remaining)], true, 'x') }))
        .state;
    expect(at(LOW_REMAINING_FRACTION * 100)).toBe('available');
    expect(at(LOW_REMAINING_FRACTION * 100 - 1)).toBe('low');
  });

  test('section summary counts serving accounts and reports the soonest focal-window reset', () => {
    expect(buildGroupSummary([healthy, low, exhausted, cooling], NOW)).toEqual({
      count: 4,
      available: 2,
      nextResetMs: NOW + HOUR,
    });
  });
});

describe('card labels', () => {
  test('rows: gating first; green with plenty left, yellow half-spent, red when low', () => {
    const rows = orderWindowRows([
      limit('spend', 50, { scope: 'spend' }),
      limit('scoped', 50, { scope: 'scoped' }),
      limit('gating', 50),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['gating', 'scoped', 'spend']);
    expect([100, 60, 59, 25, 24, 0, null].map(toneForPercent)).toEqual([
      'ok',
      'ok',
      'warn',
      'warn',
      'fault',
      'fault',
      'idle',
    ]);
    // Percent rows and the shared fraction meter can never disagree.
    for (const percent of [100, 60, 25, 24.9, 10, 0]) {
      expect(toneForPercent(percent)).toBe(toneForRemaining(percent / 100));
    }
  });

  test('credential-sheet meters use the same rule and colors as the shared Meter', () => {
    const classes = bindQuotaClasses(
      Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
      'test-host'
    );
    const render = (percent: number | null) =>
      renderToStaticMarkup(createElement(QuotaMeter, { percent, classes }));
    expect(render(84)).toContain('width:84%;background:var(--signal-ok)');
    expect(render(40)).toContain('width:40%;background:var(--signal-warn)');
    expect(render(10)).toContain('width:10%;background:var(--signal-fault)');
    expect(render(0)).toContain('width:0%;background:var(--signal-fault)');
    expect(render(null)).toContain('data-tone="idle"');
  });

  test('friendly errors keep the status code and countdowns stay compact', () => {
    expect(describeQuotaError(i18n.t, 401)).toBe('Sign-in expired (401)');
    expect(describeQuotaError(i18n.t, 503)).toBe('Provider unavailable (503)');
    expect(describeQuotaError(i18n.t, undefined)).toBe("Couldn't load quota");
    expect(formatCompactDuration(i18n.t, 2 * HOUR + 14 * 60_000)).toBe('2h 14m');
    expect(formatCompactDuration(i18n.t, 42 * 60_000 + 59_000)).toBe('42m');
    expect(formatCompactDuration(i18n.t, 30_000)).toBe('<1m');
  });

  test('titles drop .json and generated prefixes and never use account', () => {
    expect(getQuotaCardTitle({ name: 'claude-1a2b3c4d-team.json', type: 'claude' })).toBe('team');
    expect(
      getQuotaCardTitle({ name: 'x.json', type: 'xai', email: ' me@example.com ', account: 'sk-1' })
    ).toBe('me@example.com');
    expect(getQuotaCardTitle({ name: 'key.json', type: 'xai', account: 'sk-secret' })).toBe('key');
  });
});

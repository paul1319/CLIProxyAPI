/**
 * Provider overview strip and table columns: windows summed across
 * credentials, the focal window, and how rows line up under it.
 */

import { describe, expect, test } from 'bun:test';
import type { AccountLimit, AccountOverview } from '@/features/quota/accountCardModel';
import {
  snapshotAccount,
  type AccountSnapshot,
  type AccountSnapshotInput,
} from '@/features/quota/poolSummary';
import {
  aggregateWindows,
  buildProviderSummary,
  pickFocalWindow,
} from '@/features/quota/providerSummary';
import {
  MAX_WINDOW_COLUMNS,
  buildWindowColumns,
  hiddenLimits,
  pickColumnLimit,
} from '@/features/quota/tableColumns';
import { runWithConcurrency } from '@/features/quota/hooks/useQuotaBatchLoader';

const NOW = Date.UTC(2026, 9, 18, 12);
const HOUR = 3_600_000;

const limit = (id: string, remaining: number | null, extra: Partial<AccountLimit> = {}) =>
  ({ id, label: id, remaining, resetAtMs: null, scope: 'gating', ...extra }) as AccountLimit;

const overviewOf = (limits: AccountLimit[]): AccountOverview => ({
  plan: null,
  credits: [],
  renewalAtMs: null,
  notes: [],
  limits,
  heroLimitId: null,
  available: true,
});

const account = (
  key: string,
  limits: AccountLimit[] | null,
  extra: Partial<AccountSnapshotInput> = {}
): AccountSnapshot =>
  snapshotAccount({
    key,
    name: key,
    type: 'claude',
    overview: limits ? overviewOf(limits) : null,
    lamp: 'ok',
    failing: false,
    cooldownSeconds: 0,
    resets: null,
    ...extra,
  });

// Five Claude credentials from the reference: Fable 5 is the tightest window across the pool.
const claude = [
  account('a', [
    limit('five-hour', 100),
    limit('seven-day', 79, { resetAtMs: NOW + 25 * HOUR }),
    limit('seven-day-fable', 58, { scope: 'scoped', resetAtMs: NOW + 25 * HOUR }),
  ]),
  account('b', [
    limit('five-hour', 100),
    limit('seven-day', 100),
    limit('seven-day-fable', 100, { scope: 'scoped', resetAtMs: NOW + 80 * HOUR }),
  ]),
  account('c', [
    limit('five-hour', 100),
    limit('seven-day', 100),
    limit('seven-day-fable', 100, { scope: 'scoped' }),
  ]),
  account('d', [
    limit('five-hour', 99, { resetAtMs: NOW + 3 * HOUR }),
    limit('seven-day', 75, { resetAtMs: NOW + 11 * HOUR }),
    limit('seven-day-fable', 51, { scope: 'scoped', resetAtMs: NOW + 11 * HOUR }),
  ]),
  account('e', [
    limit('five-hour', 100),
    limit('seven-day', 100),
    limit('seven-day-fable', 100, { scope: 'scoped' }),
    limit('extra-usage', 40, { scope: 'spend' }),
  ]),
];

describe('provider windows', () => {
  test('sums remaining across credentials, whole-account windows first, spend caps excluded', () => {
    expect(aggregateWindows(claude.map((item) => item.overview))).toEqual([
      { id: 'five-hour', label: 'five-hour', remaining: 499, capacity: 500 },
      { id: 'seven-day', label: 'seven-day', remaining: 454, capacity: 500 },
      { id: 'seven-day-fable', label: 'seven-day-fable', remaining: 409, capacity: 500 },
    ]);
  });

  test('capacity counts only the credentials that report a value', () => {
    const windows = aggregateWindows([
      overviewOf([limit('weekly', 17)]),
      overviewOf([limit('weekly', null)]),
      null,
    ]);
    expect(windows).toEqual([{ id: 'weekly', label: 'weekly', remaining: 17, capacity: 100 }]);
  });

  test('pooled windows carry the pool in their label', () => {
    const windows = aggregateWindows([overviewOf([limit('g:5h', 40, { pool: 'Gemini Pro' })])]);
    expect(windows[0].label).toBe('Gemini Pro · g:5h');
  });

  test('the focal window is the smallest share left, model windows included, unless pinned', () => {
    const windows = aggregateWindows(claude.map((item) => item.overview));
    expect(pickFocalWindow(windows)?.id).toBe('seven-day-fable');
    expect(pickFocalWindow(windows, 'five-hour')?.id).toBe('five-hour');
    // A pinned window that disappeared falls back to the tightest one.
    expect(pickFocalWindow(windows, 'gone')?.id).toBe('seven-day-fable');
    expect(pickFocalWindow([])).toBeNull();
  });
});

describe('provider summary', () => {
  test('one segment per credential and the soonest return of a spent focal window', () => {
    const summary = buildProviderSummary('claude', claude, null, NOW);
    expect(summary.count).toBe(5);
    expect(summary.focal).toEqual({
      id: 'seven-day-fable',
      label: 'seven-day-fable',
      remaining: 409,
      capacity: 500,
    });
    expect(summary.segments.map((segment) => segment.remaining)).toEqual([58, 100, 100, 51, 100]);
    // b resets sooner than a but is full, so it brings nothing back.
    expect(summary.nextReturnAtMs).toBe(NOW + 11 * HOUR);
  });

  test('credentials without the focal window keep an unknown segment', () => {
    const summary = buildProviderSummary(
      'codex',
      [account('x', [limit('weekly', 17)]), account('y', null)],
      null,
      NOW
    );
    expect(summary.segments).toEqual([
      { key: 'x', remaining: 17 },
      { key: 'y', remaining: null },
    ]);
    expect(summary.nextReturnAtMs).toBeNull();
  });

  test('counts serving, cooling, failing and spendable resets', () => {
    const summary = buildProviderSummary(
      'codex',
      [
        account('ok', [limit('weekly', 80)], { resets: 2 }),
        account('cool', [limit('weekly', 0)], { lamp: 'warn', cooldownSeconds: 60, resets: 3 }),
        account('fail', null, { failing: true }),
      ],
      null,
      NOW
    );
    expect(summary).toMatchObject({ serving: 1, cooling: 1, failing: 1, resets: 5 });
  });

  test('no observed data leaves no focal window', () => {
    const summary = buildProviderSummary('xai', [account('x', null)], null, NOW);
    expect(summary.focal).toBeNull();
    expect(summary.windows).toEqual([]);
  });
});

describe('table columns', () => {
  test('focal window first, then scope order, capped; spend caps stay in the detail', () => {
    const overviews = claude.map((item) => item.overview);
    const columns = buildWindowColumns('claude', overviews, 'seven-day-fable');
    expect(columns.map((column) => column.id)).toEqual([
      'seven-day-fable',
      'five-hour',
      'seven-day',
    ]);
    expect(columns.length).toBeLessThanOrEqual(MAX_WINDOW_COLUMNS);
    expect(hiddenLimits(columns, claude[4].overview).map((item) => item.id)).toEqual([
      'extra-usage',
    ]);
  });

  test('windows past the cap move to the detail of each row', () => {
    const many = overviewOf([
      limit('a', 90),
      limit('b', 90),
      limit('c', 90),
      limit('d', 90, { scope: 'scoped' }),
    ]);
    const columns = buildWindowColumns('codex', [many], null);
    expect(columns.map((column) => column.id)).toEqual(['a', 'b', 'c']);
    expect(hiddenLimits(columns, many).map((item) => item.id)).toEqual(['d']);
    // A row without a column's window shows an empty cell under the column label.
    expect(pickColumnLimit(columns[0], overviewOf([limit('b', 10)]))).toBeNull();
    expect(columns[0].label).toBe('a');
  });

  test('pooled providers get one column per pool showing its tightest window', () => {
    const pooled = overviewOf([
      limit('flash:5h', 100, { pool: 'Flash' }),
      limit('pro:5h', 80, { pool: 'Pro' }),
      limit('pro:week', 30, { pool: 'Pro' }),
    ]);
    const columns = buildWindowColumns('antigravity', [pooled], 'pro:5h');
    expect(columns).toEqual([
      { id: 'pool:Pro', label: 'Pro', pool: 'Pro' },
      { id: 'pool:Flash', label: 'Flash', pool: 'Flash' },
    ]);
    expect(pickColumnLimit(columns[0], pooled)?.id).toBe('pro:week');
    expect(hiddenLimits(columns, pooled).map((item) => item.id)).toEqual(['pro:5h']);
  });
});

describe('batch loading', () => {
  test('never runs more than the limit at once and visits every item', async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      await Promise.resolve();
      seen.push(item);
      active -= 1;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    await runWithConcurrency([], 3, async () => {
      throw new Error('never called');
    });
  });
});

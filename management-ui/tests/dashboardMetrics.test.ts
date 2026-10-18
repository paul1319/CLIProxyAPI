import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { summarizePool } from '../src/components/layout/poolRail';
import { formatCompactNumber, formatPercent } from '../src/utils/format';
import { getProviderKeyCounts } from '../src/features/dashboard/hooks/useDashboardOverview';
import {
  axisMax,
  niceCeil,
  providerIdOfAuthFile,
  providerLabel,
  splitDuration,
  splitWindowMinutes,
  toneForSuccessRate,
} from '../src/features/dashboard/utils';
import {
  collectQuotaReadings,
  summarizeQuota,
  type QuotaSources,
} from '../src/features/dashboard/quota';
import { buildAttentionItems } from '../src/features/dashboard/attention';
import type { AuthFileItem } from '../src/types/authFile';

describe('formatCompactNumber', () => {
  test('leaves values below one thousand alone', () => {
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(999)).toBe('999');
  });

  test('compacts with a single decimal and no redundant .0', () => {
    expect(formatCompactNumber(1000)).toBe('1K');
    expect(formatCompactNumber(1284)).toBe('1.3K');
    expect(formatCompactNumber(12_900)).toBe('12.9K');
    expect(formatCompactNumber(1_500_000)).toBe('1.5M');
  });

  test('carries into the next tier instead of rendering 1000K', () => {
    expect(formatCompactNumber(999_999)).toBe('1M');
    expect(formatCompactNumber(999_999_999)).toBe('1B');
  });

  test('keeps the sign and survives non-finite input', () => {
    expect(formatCompactNumber(-1500)).toBe('-1.5K');
    expect(formatCompactNumber(Number.NaN)).toBe('0');
  });
});

describe('formatPercent', () => {
  test('trims trailing zeros but keeps meaningful decimals', () => {
    expect(formatPercent(100)).toBe('100%');
    expect(formatPercent(99.5)).toBe('99.5%');
    expect(formatPercent(0)).toBe('0%');
  });

  test('renders an em dash for non-finite rates', () => {
    expect(formatPercent(Number.NaN)).toBe('—');
  });
});

describe('niceCeil', () => {
  test('rounds up onto the step ladder', () => {
    expect(niceCeil(1)).toBe(1);
    expect(niceCeil(7)).toBe(8);
    expect(niceCeil(12)).toBe(15);
    expect(niceCeil(48)).toBe(50);
    expect(niceCeil(320)).toBe(400);
  });

  test('never returns zero, so bar heights cannot divide by zero', () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(-5)).toBe(1);
  });
});

describe('axisMax', () => {
  test('lands every gridline on a whole number', () => {
    // Peak 112 → top 120 (ticks 0/30/60/90/120), not 200 which wastes half the chart.
    expect(axisMax(112, 4)).toBe(120);
    expect(axisMax(7, 4)).toBe(8);
    expect(axisMax(1533, 4)).toBe(1600);
  });

  test('keeps the axis just above the peak', () => {
    for (const peak of [1, 3, 9, 17, 64, 112, 250, 999, 4321]) {
      const max = axisMax(peak, 4);
      expect(max).toBeGreaterThanOrEqual(peak);
      // The top must stay below twice the peak or the bars get squashed.
      // Tiny peaks are bounded by "at least 1 per interval", i.e. the interval count.
      expect(max).toBeLessThanOrEqual(Math.max(4, peak * 2));
      // Every interval must be a whole number.
      expect(Number.isInteger(max / 4)).toBe(true);
    }
  });

  test('degrades safely with no traffic', () => {
    expect(axisMax(0, 4)).toBe(4);
    expect(axisMax(-3, 4)).toBe(4);
  });
});

describe('toneForSuccessRate', () => {
  test('maps a rate onto a severity band', () => {
    expect(toneForSuccessRate(null)).toBe('idle');
    expect(toneForSuccessRate(100)).toBe('good');
    expect(toneForSuccessRate(95)).toBe('good');
    expect(toneForSuccessRate(94.9)).toBe('warning');
    expect(toneForSuccessRate(80)).toBe('warning');
    expect(toneForSuccessRate(79.9)).toBe('critical');
  });
});

describe('splitWindowMinutes', () => {
  test('splits the rolling window into hours and minutes', () => {
    expect(splitWindowMinutes(200)).toEqual({ hours: 3, minutes: 20 });
    expect(splitWindowMinutes(60)).toEqual({ hours: 1, minutes: 0 });
    expect(splitWindowMinutes(40)).toEqual({ hours: 0, minutes: 40 });
  });
});

describe('provider key counts', () => {
  test('includes Muse API keys and defaults missing configuration to zero', () => {
    expect(getProviderKeyCounts({ metaApiKeys: [{ apiKey: 'fixture-meta-key' }] }).meta).toBe(1);
    expect(getProviderKeyCounts({}).meta).toBe(0);
  });
  test('includes native Interactions API keys in the dashboard total inputs', () => {
    const counts = getProviderKeyCounts({
      geminiApiKeys: [{ apiKey: 'gemini-key' }],
      interactionsApiKeys: [{ apiKey: 'interactions-1' }, { apiKey: 'interactions-2' }],
      codexApiKeys: [{ apiKey: 'codex-key' }],
    });

    expect(counts.interactions).toBe(2);
    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(4);
  });
});

describe('providerLabel', () => {
  test('uses the brand spelling for known providers', () => {
    expect(providerLabel('xai', 'Unattributed')).toBe('xAI');
    expect(providerLabel('aistudio', 'Unattributed')).toBe('AI Studio');
    expect(providerLabel('gemini-interactions', 'Unattributed')).toBe('Interactions API');
  });

  test('falls back to a capitalised id, and localises unknown', () => {
    expect(providerLabel('somenewbrand', 'Unattributed')).toBe('Somenewbrand');
    expect(providerLabel('unknown', 'Unattributed')).toBe('Unattributed');
    expect(providerLabel('', 'Unattributed')).toBe('Unattributed');
  });
});

describe('splitDuration', () => {
  test('truncates like a countdown and clamps negatives', () => {
    expect(splitDuration(42 * 60_000 + 59_000)).toEqual({ days: 0, hours: 0, minutes: 42 });
    expect(splitDuration((2 * 60 + 14) * 60_000)).toEqual({ days: 0, hours: 2, minutes: 14 });
    expect(splitDuration((3 * 24 + 9) * 3_600_000)).toEqual({ days: 3, hours: 9, minutes: 0 });
    expect(splitDuration(-5_000)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});

describe('providerIdOfAuthFile', () => {
  test('prefers type, falls back to provider, and maps blanks to unknown', () => {
    expect(providerIdOfAuthFile({ name: 'a.json', type: 'Codex' })).toBe('codex');
    expect(providerIdOfAuthFile({ name: 'a.json', provider: 'claude' })).toBe('claude');
    expect(providerIdOfAuthFile({ name: 'a.json', type: 'empty' })).toBe('unknown');
    expect(providerIdOfAuthFile({ name: 'a.json' })).toBe('unknown');
  });
});

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const emptySources = (): QuotaSources => ({
  antigravityQuota: {},
  claudeQuota: {},
  codexQuota: {},
  devinQuota: {},
  kimiQuota: {},
  metaQuota: {},
  pluginQuota: {},
  xaiQuota: {},
});

describe('overview quota digest', () => {
  const sources = (): QuotaSources => ({
    ...emptySources(),
    codexQuota: {
      'codex-a.json': {
        status: 'success',
        windows: [
          { id: '5h', label: '5h', usedPercent: 100, resetLabel: '', resetAtMs: NOW + 42 * MIN },
          {
            id: 'week',
            label: 'week',
            usedPercent: 40,
            resetLabel: '',
            resetAtMs: NOW + 3 * 1440 * MIN,
          },
        ],
      },
      'codex-b.json': {
        status: 'success',
        windows: [
          { id: '5h', label: '5h', usedPercent: 10, resetLabel: '', resetAtMs: NOW + 90 * MIN },
        ],
      },
      // Loading and failed reads say nothing about capacity.
      'codex-c.json': { status: 'error', windows: [], error: 'boom' },
    },
    antigravityQuota: {
      'ag.json': {
        status: 'success',
        groups: [
          {
            id: 'g',
            label: 'Gemini',
            buckets: [{ id: 'b', label: '5h', remainingFraction: 0.3, resetAtMs: NOW + 20 * MIN }],
          },
        ],
      },
    },
    claudeQuota: {
      'claude-off.json': {
        status: 'success',
        windows: [
          { id: '5h', label: '5h', usedPercent: 100, resetLabel: '', resetAtMs: NOW + 5 * MIN },
        ],
      },
    },
  });

  const files = [
    { name: 'codex-a.json', provider: 'codex', disabled: false },
    { name: 'codex-b.json', provider: 'codex', disabled: false },
    { name: 'codex-c.json', provider: 'codex', disabled: false },
    { name: 'ag.json', provider: 'antigravity', disabled: false },
    { name: 'claude-off.json', provider: 'claude', disabled: true },
  ];

  test('collects only observed windows, keyed by file name', () => {
    const readings = collectQuotaReadings(sources());
    expect(readings.get('codex-a.json')).toEqual([
      { remaining: 0, resetAtMs: NOW + 42 * MIN },
      { remaining: 0.6, resetAtMs: NOW + 3 * 1440 * MIN },
    ]);
    expect(readings.has('codex-c.json')).toBe(false);
  });

  test('reports the lowest window per provider and the next constrained reset', () => {
    const overview = summarizeQuota(collectQuotaReadings(sources()), files, NOW);
    expect(overview.known).toBe(true);
    expect(overview.byProvider.get('codex')).toEqual({ remaining: 0, resetAtMs: NOW + 42 * MIN });
    expect(overview.byProvider.get('antigravity')?.remaining).toBeCloseTo(0.3);
    // Disabled credentials neither count as known quota nor supply the next reset.
    expect(overview.byProvider.has('claude')).toBe(false);
    expect(overview.nextReset).toEqual({
      atMs: NOW + 20 * MIN,
      provider: 'antigravity',
      remaining: 0.3,
    });
  });

  test('stays unknown when the quota store is empty', () => {
    const overview = summarizeQuota(collectQuotaReadings(emptySources()), files, NOW);
    expect(overview).toEqual({ known: false, byProvider: new Map(), nextReset: null });
  });

  test('ignores resets that already passed', () => {
    const stale: QuotaSources = {
      ...emptySources(),
      codexQuota: {
        'codex-a.json': {
          status: 'success',
          windows: [
            { id: '5h', label: '5h', usedPercent: 100, resetLabel: '', resetAtMs: NOW - MIN },
          ],
        },
      },
    };
    const overview = summarizeQuota(collectQuotaReadings(stale), files, NOW);
    expect(overview.byProvider.get('codex')).toEqual({ remaining: 0, resetAtMs: null });
    expect(overview.nextReset).toBeNull();
  });
});

describe('needs-attention rows', () => {
  const cooldown = (scope: 'credential' | 'model', remainingSeconds: number, reason = 'quota') => ({
    receivedAtMs: NOW,
    records: [
      {
        scope,
        reason,
        retryAt: '2026-01-01T00:00:00Z',
        remainingSeconds,
        httpStatus: 429,
        ...(scope === 'model' ? { modelKey: 'gpt-5' } : {}),
      },
    ],
  });

  const files: AuthFileItem[] = [
    { name: 'ok.json', type: 'codex', email: 'ok@example.com' },
    { name: 'off.json', type: 'codex', disabled: true, unavailable: true },
    {
      name: 'broken.json',
      type: 'antigravity',
      email: 'broken@example.com',
      unavailable: true,
      statusMessage: 'refresh token revoked',
    },
    {
      name: 'cool.json',
      type: 'codex',
      email: 'cool@example.com',
      cooldownSnapshot: cooldown('credential', 42 * 60),
    },
    {
      name: 'model.json',
      type: 'claude',
      cooldownSnapshot: cooldown('model', 120, 'unauthorized'),
    },
  ];

  test('lists failing credentials first, then cooldowns by time left; skips healthy and disabled', () => {
    const items = buildAttentionItems(files, NOW);
    expect(items.map((item) => item.id)).toEqual(['broken.json', 'model.json', 'cool.json']);

    const [broken, model, cool] = items;
    expect(broken).toMatchObject({
      state: 'fault',
      lamp: 'fault',
      label: 'broken@example.com',
      provider: 'antigravity',
      message: 'refresh token revoked',
      to: '/auth-files',
    });
    expect(cool).toMatchObject({ state: 'warn', lamp: 'warn', to: '/quota' });
    expect(cool.cooldown).toMatchObject({
      credentialWide: true,
      earliestSeconds: 42 * 60,
      remainingSeconds: 42 * 60,
    });
    // No email: the file name is the identity and renders in mono. A model-only cooldown
    // still serves, so its lamp stays green exactly like the Credentials row and the rail.
    expect(model).toMatchObject({ state: 'warn', lamp: 'ok', label: 'model', mono: true });
    expect(model.cooldown).toMatchObject({ credentialWide: false, modelCount: 1 });
  });

  test('counts cooldowns down from the local receipt instant and drops expired model timers', () => {
    const items = buildAttentionItems(files, NOW + 2 * MIN);
    expect(items.map((item) => item.id)).toEqual(['broken.json', 'cool.json']);
    expect(items[1].cooldown?.earliestSeconds).toBe(40 * 60);
  });
});

describe('cross-page consistency', () => {
  const attentionPanel = readFileSync(
    'src/features/dashboard/components/AttentionPanel.tsx',
    'utf8'
  );
  const credentialRow = readFileSync('src/features/authFiles/components/AuthFileRow.tsx', 'utf8');
  const poolPanel = readFileSync('src/features/dashboard/components/PoolPanel.tsx', 'utf8');
  const providerTable = readFileSync('src/features/dashboard/components/ProviderTable.tsx', 'utf8');

  test('attention rows and credential rows share one cooldown formatter and the rail lamp', () => {
    expect(attentionPanel).toContain('formatCooldownLine(t, item.cooldown');
    expect(credentialRow).toContain('formatCooldownLine(t, problem');
    expect(attentionPanel).not.toContain('cooldownReasonKey');
    expect(attentionPanel).toContain('<StatusLamp state={item.lamp}');
  });

  test('the overview lamp row keeps the sidebar rail order (ok → warn → fault → idle)', () => {
    expect(poolPanel).not.toContain('LAMP_ORDER');
    expect(poolPanel).toContain('const lamps = pool.lamps;');
    const pool = summarizePool([
      { name: 'off.json', disabled: true },
      { name: 'broken.json', unavailable: true },
      {
        name: 'cool.json',
        cooldownSnapshot: {
          receivedAtMs: NOW,
          records: [{ scope: 'credential', reason: 'quota', retryAt: '', remainingSeconds: 60 }],
        },
      },
      { name: 'ok.json' },
    ] as AuthFileItem[]);
    expect(pool.lamps.map((lamp) => lamp.state)).toEqual(['ok', 'warn', 'fault', 'idle']);
  });

  test('lowest quota uses the shared capacity tone', () => {
    expect(providerTable).toContain('toneForRemaining(quota.remaining)');
    expect(providerTable).toContain('data-tone={quotaTone}');
  });
});

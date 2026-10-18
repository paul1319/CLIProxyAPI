/**
 * Quota page layout: provider overview strip, per-provider tables whose cells
 * line up through subgrid, and names blurred until revealed.
 *
 * Rendering goes through renderToStaticMarkup; stylesheet contracts stay
 * textual because a `.module.scss` import is raw source under `bun test`.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import type { AccountLimit, AccountOverview } from '@/features/quota/accountCardModel';
import { ProviderOverview } from '@/features/quota/components/ProviderOverview';
import { QuotaRow, type QuotaRowProps } from '@/features/quota/components/QuotaRow';
import type { ProviderSummary } from '@/features/quota/providerSummary';
import type { QuotaCardState } from '@/features/quota/providers';
import type { AuthFileItem } from '@/types';

const read = (path: string) => Bun.file(new URL(`../${path}`, import.meta.url)).text();
const HOUR = 3_600_000;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const limit = (id: string, remaining: number | null, extra: Partial<AccountLimit> = {}) =>
  ({ id, label: id, remaining, resetAtMs: null, scope: 'gating', ...extra }) as AccountLimit;

const overviewOf = (limits: AccountLimit[], extra: Partial<AccountOverview> = {}) =>
  ({
    plan: 'Pro 20x',
    credits: [],
    renewalAtMs: null,
    notes: [],
    limits,
    heroLimitId: null,
    available: true,
    ...extra,
  }) as AccountOverview;

const renderRow = (props: Partial<QuotaRowProps>) => {
  const file = { name: 'codex-alice@example.com-pro.json', type: 'codex' } as AuthFileItem;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(QuotaRow, {
        entry: { file, type: 'codex' },
        quota: { status: 'success' } as unknown as QuotaCardState,
        overview: null,
        columns: [],
        showResets: false,
        cooldown: null,
        revealed: false,
        onToggleName: () => {},
        canRefresh: true,
        resetting: false,
        onRefresh: () => {},
        onReset: () => {},
        ...props,
      })
    )
  );
};

describe('provider overview strip', () => {
  // One instant for the summary and the render, so "back in 1d 2h" cannot
  // truncate to "1d 1h" when a millisecond passes between the two.
  const now = Date.now();
  const summary: ProviderSummary = {
    type: 'claude',
    count: 5,
    serving: 5,
    cooling: 1,
    failing: 0,
    resets: 2,
    windows: [
      { id: 'five-hour', label: '5-hour limit', remaining: 499, capacity: 500 },
      { id: 'seven-day-fable', label: '7-day Fable 5', remaining: 409, capacity: 500 },
    ],
    focal: { id: 'seven-day-fable', label: '7-day Fable 5', remaining: 409, capacity: 500 },
    segments: [
      { key: 'a', remaining: 58 },
      { key: 'b', remaining: 100 },
      { key: 'c', remaining: 10 },
      { key: 'd', remaining: null },
    ],
    nextReturnAtMs: now + 26 * HOUR,
  };
  const render = (overrides: Partial<ProviderSummary> = {}, filterable = true) =>
    renderToStaticMarkup(
      createElement(ProviderOverview, {
        summaries: [{ ...summary, ...overrides }],
        selected: null,
        filterable,
        now,
        onSelect: () => {},
        onFocalChange: () => {},
      })
    );

  test('sums the focal window across credentials with one colored segment each', () => {
    const html = render();
    expect(html).toContain('409%');
    expect(html).toContain('of 500%');
    expect(html).toContain('7-day Fable 5');
    expect(html).toContain('back in 1d 2h');
    expect([...html.matchAll(/data-tone="(\w+)"/g)].map((match) => match[1])).toEqual([
      'warn',
      'ok',
      'fault',
      'idle',
    ]);
    // Other windows, spendable resets and attention sit in the footer.
    expect(html).toContain('5-hour limit');
    expect(html).toContain('499%');
    expect(html).toContain('Manual resets');
    expect(html).toContain('1 cooling down');
  });

  test('the column filters the table only when there is something to filter', () => {
    expect(render()).toContain('aria-pressed="false"');
    expect(render()).toContain('Show only Claude');
    expect(render({}, false)).not.toContain('aria-pressed');
  });

  test('a provider without readings says so instead of inventing a figure', () => {
    const html = render({ focal: null, windows: [], segments: [{ key: 'x', remaining: null }] });
    expect(html).toContain('—');
    expect(html).toContain('of 500%');
    expect(html).toContain('No data yet');
  });
});

describe('credential row', () => {
  const overview = overviewOf([
    limit('weekly', 17, { label: 'Weekly', resetAtMs: Date.now() + 54 * HOUR }),
    limit('five-hour', 100, { label: '5-hour' }),
    limit('review', 0, { label: 'Code review', scope: 'scoped', resetAtMs: Date.now() + HOUR }),
  ]);
  const columns = [
    { id: 'weekly', label: 'Weekly', pool: null },
    { id: 'five-hour', label: '5-hour', pool: null },
    { id: 'monthly', label: 'Monthly', pool: null },
  ];

  test('names are blurred until revealed and never leak through the tooltip', () => {
    const hidden = renderRow({ overview, columns });
    expect(hidden).toContain('data-hidden="true"');
    expect(hidden).toContain('aria-pressed="false"');
    expect(hidden).toContain('title="Show name"');
    expect(hidden).not.toContain('title="codex-alice@example.com-pro.json"');

    const shown = renderRow({ overview, columns, revealed: true });
    expect(shown).not.toContain('data-hidden');
    expect(shown).toContain('aria-pressed="true"');
    expect(shown).toContain('title="codex-alice@example.com-pro.json"');
  });

  test('one cell per section column: percent, colored meter, reset or "No reset pending"', () => {
    const html = renderRow({ overview, columns });
    expect(html).toContain('17%');
    expect(html).toContain('in 2d 6h');
    expect(html).toContain('No reset pending');
    // A column this credential does not report keeps its place with a dash.
    expect(html).toContain('Monthly');
    // Code review sits past the columns and opens from the row.
    expect(html).toContain('+1 more');
    expect(html).not.toContain('Code review');
  });

  test('the reset action sits next to its count in the resets cell', () => {
    const quota = {
      status: 'success',
      rateLimitResetCreditsAvailableCount: 2,
    } as unknown as QuotaCardState;
    const html = renderRow({ overview, columns, quota, showResets: true });
    expect(html).toContain('data-slot="resets"');
    expect(html).toMatch(/<strong>2<\/strong> available<\/span><button[^>]*>[\s\S]*?Use reset/);

    // A section without a resets column keeps the action with the row actions.
    const bare = renderRow({ overview, columns, quota, showResets: false });
    expect(bare).not.toContain('data-slot="resets"');
    expect(bare).toContain('Use reset');
  });

  test('without data the cells give way to one status line with recovery actions', () => {
    const html = renderRow({
      quota: { status: 'error', errorStatus: 401 } as unknown as QuotaCardState,
    });
    expect(html).toContain('data-tone="fault"');
    expect(html).toContain('Sign-in expired (401)');
    expect(html).toContain('Retry');
    expect(html).toContain('href="/oauth"');
  });
});

describe('page and stylesheet contracts', () => {
  test('no search box and no pagination; every credential is polled', async () => {
    const page = await read('src/features/quota/QuotaPage.tsx');
    expect(page).not.toContain('type="search"');
    expect(page).not.toMatch(/paginate|QUOTA_PAGE_SIZE|pageItems/);
    expect(page).toContain(
      '() => [...entries].sort((a, b) => (entryKey(a) < entryKey(b) ? -1 : 1)),'
    );
    expect(page).toContain(
      'const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());'
    );
  });

  test('every section subgrids into one page grid; resets and actions keep their tracks', async () => {
    const css = await read('src/features/quota/components/QuotaTable.module.scss');
    const block = (selector: string) =>
      css.match(new RegExp(`\\n\\.${selector}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
    expect(block('grid')).toContain('repeat(var(--quota-slots), minmax(0, 1fr))');
    for (const selector of ['section', 'frame', 'table', 'row']) {
      expect(block(selector)).toContain('grid-template-columns: subgrid;');
    }
    expect(css).toMatch(/\n\.cell\[data-slot='resets'\]\s*\{\s*grid-column: -3 \/ -2;/);
    expect(block('actions')).toContain('grid-column: -2 / -1;');
    expect(block('status')).toContain('grid-column: 2 / -2;');
    expect(css).toMatch(/\[data-hidden\] > &\s*\{\s*filter: blur\(5px\);/);
    expect(css).toContain('@container quota-table (max-width: 720px)');
  });

  test('new quota stylesheets use tokens only', async () => {
    for (const path of [
      'src/features/quota/components/QuotaTable.module.scss',
      'src/features/quota/components/ProviderOverview.module.scss',
      'src/features/quota/components/ProviderGlyph.module.scss',
      'src/features/quota/QuotaPage.module.scss',
    ]) {
      const css = await read(path);
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css).not.toMatch(/--(text|bg|border|primary)-/);
    }
  });
});

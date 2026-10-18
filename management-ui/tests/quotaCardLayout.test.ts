/**
 * Quota card layout contract.
 *
 * Cards in a provider section share grid rows through subgrid — one row per
 * top-level block (header, hero, windows, footer) — so heroes, window lists and
 * footers line up and a refresh never shifts a neighbour. Like quotaClassContract
 * this is textual: QuotaCard imports its stylesheet and cannot be rendered under
 * `bun test`. It relies on Prettier placing the card's direct children at a
 * fixed indent.
 */

import { expect, test } from 'bun:test';

const read = (path: string) => Bun.file(new URL(`../${path}`, import.meta.url)).text();

const cardSource = () => read('src/features/quota/components/QuotaCard.tsx');
const cardStyles = () => read('src/features/quota/components/QuotaCard.module.scss');

test('every quota card block occupies one shared subgrid row', async () => {
  const css = await cardStyles();
  const card = css.match(/\n\.card\s*\{([^}]+)\}/)?.[1] ?? '';
  expect(card).toContain('grid-template-rows: subgrid;');
  const span = Number(card.match(/grid-row:\s*span\s+(\d+);/)?.[1]);

  const tsx = await cardSource();
  const article = tsx.match(/\n {4}<article[\s\S]*?\n {4}<\/article>/)?.[0] ?? '';
  const blocks = [...article.matchAll(/^ {6}<([a-z][\w]*)\b/gm)].map((match) => match[1]);
  expect(blocks).toEqual(['header', 'div', 'div', 'footer']);
  expect(span).toBe(blocks.length);
  // A conditional top-level block would shift every following block onto the wrong row.
  expect(article).not.toMatch(/^ {6}\{/m);
  // The footer is always rendered; an empty one collapses instead of disappearing from the tree.
  expect(article).toContain('<footer className={hasFooter ? styles.foot : styles.footEmpty}>');
});

test('a refresh keeps visible data in place instead of swapping in a loading body', async () => {
  const tsx = await cardSource();
  const hero = tsx.slice(tsx.indexOf('function HeroBody'));
  // Observed data wins over every transient status; loading only renders for unobserved cards.
  expect(hero.indexOf('if (overview) {')).toBeGreaterThan(-1);
  expect(hero.indexOf('if (overview) {')).toBeLessThan(hero.indexOf("status === 'loading'"));
  expect(hero.indexOf('if (overview) {')).toBeLessThan(hero.indexOf("status === 'error'"));
});

test('card errors are quiet: no alert role, friendly copy with the status kept', async () => {
  const tsx = await cardSource();
  expect(tsx).not.toContain('role="alert"');
  expect(tsx).toContain('describeQuotaError(t, quota?.errorStatus)');
  expect(tsx).toContain("t('quota_management.error_retry_at'");
});

test('no decorative entrance animation; window meters use the shared Meter and tone rule', async () => {
  const css = await cardStyles();
  expect(css).not.toMatch(/cardEnter|card-in|animation-delay/);
  expect(css).not.toContain('--signal-ok');
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  const windows = await read('src/features/quota/components/QuotaWindows.tsx');
  expect(windows).toContain("import { Meter } from '@/components/ui/Meter';");
  expect(windows).toMatch(
    /<Meter[\s\S]*?value=\{percentToFraction\(limit\.remaining\)\}[\s\S]*?tone=\{tone\}/
  );
  const rows = await read('src/features/quota/windowRows.ts');
  expect(rows).toContain('return toneForRemaining(percentToFraction(remaining));');
  // No page-local thresholds left anywhere in the quota feature.
  for (const path of [
    'src/features/quota/windowRows.ts',
    'src/features/quota/poolSummary.ts',
    'src/features/quota/components/QuotaMeter.tsx',
  ]) {
    const source = await read(path);
    expect(source).not.toMatch(/THRESHOLD|LOW_REMAINING_PERCENT = \d/);
  }
});

test('long window labels wrap to two lines beside a fixed meter column', async () => {
  const css = await cardStyles();
  expect(css).toContain('grid-template-columns: minmax(0, 1fr) 72px auto auto;');
  const label = css.match(/\n\.rowLabel\s*\{([^}]+)\}/)?.[1] ?? '';
  expect(label).toContain('-webkit-line-clamp: 2;');
  const tsx = await read('src/features/quota/components/QuotaWindows.tsx');
  expect(tsx).toContain('title={limit.amount ? `${limit.label} · ${limit.amount}` : limit.label}');
});

test('footer facts never leave a dangling separator when they wrap', async () => {
  const css = await cardStyles();
  const fact = css.match(/\n\.fact\s*\{([^}]+)\}/)?.[1] ?? '';
  expect(fact).toContain('white-space: nowrap;');
  expect(css).not.toMatch(/\.fact[^{]*::(after|before)/);
  // The reset summary is one unit; the action wraps below it instead of splitting it.
  expect(css).toMatch(/\.resetLine\s*\{[^}]*flex-wrap: wrap;/);
  const tsx = await cardSource();
  expect(tsx).toContain("{resetSummary?.join(' · ')}");
});

test('the account lamp is the shared credential lamp, not a capacity tone', async () => {
  const tsx = await cardSource();
  expect(tsx).toContain('const lamp = getCredentialLampState(file);');
  expect(tsx).toContain('<StatusLamp state={lamp} label={t(LAMP_LABEL[lamp])} />');
  expect(tsx).not.toContain('snapshot.tone');
});

test('sections use a 300px minimum card track', async () => {
  const css = await read('src/features/quota/QuotaPage.module.scss');
  expect(css).toContain('grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));');
});

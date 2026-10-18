/**
 * Quota card layout contract.
 *
 * Cards share page-grid rows through subgrid, one row per top-level block, so the
 * span in the stylesheet must match the blocks the card always renders. Like
 * quotaClassContract this is textual: QuotaCard imports its stylesheet and cannot
 * be rendered under `bun test`. It relies on Prettier placing the card's direct
 * children at a fixed indent.
 */

import { expect, test } from 'bun:test';

const read = (path: string) => Bun.file(new URL(`../${path}`, import.meta.url)).text();

test('every quota card block occupies one shared subgrid row', async () => {
  const css = await read('src/features/quota/components/QuotaCard.module.scss');
  const card = css.match(/\n\.card\s*\{([^}]+)\}/)?.[1] ?? '';
  expect(card).toContain('grid-template-rows: subgrid;');
  const span = Number(card.match(/grid-row:\s*span\s+(\d+);/)?.[1]);

  const tsx = await read('src/features/quota/components/QuotaCard.tsx');
  const article = tsx.match(/\n {4}<article[\s\S]*?\n {4}<\/article>/)?.[0] ?? '';
  const blocks = [...article.matchAll(/^ {6}<([a-z][\w]*)\b/gm)].map((match) => match[1]);
  expect(blocks).toEqual(['header', 'dl', 'div', 'section', 'div', 'footer']);
  expect(span).toBe(blocks.length);
  // A conditional top-level block would shift every following block onto the wrong row.
  expect(article).not.toMatch(/^ {6}\{/m);
});

test('a refresh keeps visible data in place instead of inserting a loading row', async () => {
  const tsx = await read('src/features/quota/components/QuotaCard.tsx');
  expect(tsx).toContain('{loading && !showData && (');
});

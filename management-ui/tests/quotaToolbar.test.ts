import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/features/quota/QuotaPage.tsx', 'utf8');
const styles = readFileSync('src/features/quota/QuotaPage.module.scss', 'utf8');
const tabsStyles = readFileSync('src/features/quota/components/ProviderTabs.module.scss', 'utf8');
const underlineStyles = readFileSync(
  'src/features/authFiles/components/UnderlineTabs.module.scss',
  'utf8'
);

const block = (css: string, selector: string) =>
  css.match(new RegExp(`\\n${selector.replace('.', '\\.')}\\s*\\{([^}]+)\\}`))?.[1] ?? '';

describe('quota toolbar presentation contracts', () => {
  test('uses a named, explicit clear action and restores input focus', () => {
    expect(source).toContain('type="search"');
    expect(source).toContain('ref={searchInputRef}');
    expect(source).toContain('{search && (');
    expect(source).toContain("aria-label={t('quota_management.search_clear')}");
    expect(source).toMatch(/handleSearchChange\(''\);\s*searchInputRef\.current\?\.focus\(\);/);
    expect(source).toContain('<IconX size={14} aria-hidden="true" />');
    expect(styles).toMatch(/&::-webkit-search-cancel-button,[\s\S]*?appearance: none;/);
    // A short placeholder fits every locale; the full hint lives in the tooltip.
    expect(source).toContain("placeholder={t('quota_management.search_placeholder')}");
    expect(source).toContain("title={t('quota_management.search_hint')}");
  });

  test('orders provider filter, search and a single "Sort: mode" menu in one toolbar', () => {
    const toolbarStart = source.indexOf('<div className={showTabs ?');
    const filtersStart = source.indexOf('<div className={styles.filters}>');
    const searchStart = source.indexOf('<div className={styles.search}>');
    const sortStart = source.indexOf('<div className={styles.sort}>');
    expect(toolbarStart).toBeGreaterThan(-1);
    expect(filtersStart).toBeGreaterThan(toolbarStart);
    expect(source.indexOf('<ProviderTabs')).toBeGreaterThan(filtersStart);
    expect(searchStart).toBeGreaterThan(source.indexOf('<ProviderTabs'));
    expect(sortStart).toBeGreaterThan(searchStart);
    // Same pattern as the credentials toolbar: the label and value share one trigger.
    expect(source).toContain('<ActionMenu');
    expect(source).toContain("t('quota_management.sort_by', {");
    expect(source).toContain("label={t('quota_management.sort_label')}");
    expect(source).toContain('checked: sortMode === mode,');
    expect(source).not.toContain('<Select');
    expect(styles).toMatch(/\.toolbar\s*\{[^}]*flex-wrap: wrap;/);
    expect(styles).toContain('&:focus-within');
    expect(styles).toContain('&:focus-visible');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  test('provider tabs list only providers that have accounts', () => {
    expect(source).toContain(
      "['all', ...QUOTA_TAB_ORDER.filter((type) => (tabCounts[type] ?? 0) > 0)]"
    );
    // A single provider needs no filter at all.
    expect(source).toContain('const showTabs = tabTypes.length > 2;');
    expect(source).toContain('{showTabs && (');
  });

  test('the tab hairline spans the whole toolbar row, and the tabs row on mobile', () => {
    expect(block(styles, '.toolbarTabs')).toContain('box-shadow: inset 0 -1px 0 var(--rule);');
    expect(block(tabsStyles, '.tabs')).not.toContain('border-bottom');
    const mobile = styles.slice(styles.indexOf('@include mobile'));
    expect(mobile).toMatch(/\.filters\s*\{[^}]*box-shadow: inset 0 -1px 0 var\(--rule\);/);
  });

  test('provider tabs follow the underline-tab spec used by Credentials', () => {
    const tab = block(tabsStyles, '.tab');
    const underlineTab = block(underlineStyles, '.tab');
    for (const rule of [
      'font-size: $text-md;',
      'font-weight: 500;',
      'color: var(--ink-3);',
      'background: none;',
    ]) {
      expect(underlineTab).toContain(rule);
      expect(tab).toContain(rule);
    }
    expect(tabsStyles).toMatch(
      /\.tabActive\s*\{\s*color: var\(--ink\);\s*&::after\s*\{\s*background: var\(--ink\);/
    );
    expect(tabsStyles).toMatch(/&::after\s*\{[^}]*height: 2px;/);
    // Counts are plain mono numbers, never tinted pills.
    const count = block(tabsStyles, '.count');
    expect(count).toContain('font-family: $font-mono;');
    expect(count).toContain('color: var(--ink-3);');
    expect(count).not.toContain('background');
    // No legacy aliases, no hover fill, no folder-tab radius.
    expect(tabsStyles).not.toMatch(/--(text|bg|border|primary)-/);
    expect(tabsStyles).not.toMatch(/\.tab:hover\s*\{[^}]*background/);
    expect(tabsStyles).not.toContain('8px 8px 0 0');
  });

  test('the header uses the shared PageHeader with a ghost refresh-all action', () => {
    expect(source).toContain('<PageHeader');
    expect(source).toMatch(/<Button\s+variant="ghost"\s+size="sm"\s+onClick=\{handleRefreshAll\}/);
    expect(source).toMatch(/<IconRefreshCw\s+size=\{14\}/);
    // Background polling never spins the toolbar; only manual reloads do.
    expect(source).toContain('const refreshing = batchLoading || (loading && files.length > 0);');
  });
});

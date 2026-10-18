import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readStripOverflow } from '@/features/quota/components/providerTabsOverflow';

const tabsSource = readFileSync('src/features/quota/components/ProviderTabs.tsx', 'utf8');
const tabsStyles = readFileSync('src/features/quota/components/ProviderTabs.module.scss', 'utf8');
const quotaStyles = readFileSync('src/features/quota/QuotaPage.module.scss', 'utf8');

describe('provider filter overflow', () => {
  test('constrains the strip and preserves native horizontal scrolling', () => {
    expect(tabsStyles).toMatch(/\.tabs\s*\{[^}]*min-width: 0;/);
    expect(tabsStyles).toMatch(/\.tabs\s*\{[^}]*max-width: calc\(100% \+ 8px\);/);
    expect(tabsStyles).toMatch(/\.tabs\s*\{[^}]*overflow-x: auto;/);
    expect(tabsStyles).toMatch(/\.tab\s*\{[^}]*flex-shrink: 0;/);
  });

  test('hides the scrollbar while using a cancellable local wheel listener', () => {
    expect(tabsStyles).toContain('scrollbar-width: none;');
    expect(tabsStyles).toMatch(/&::-webkit-scrollbar\s*\{[^}]*display: none/);
    expect(tabsSource).toContain("strip.addEventListener('wheel', onWheel, { passive: false })");
    expect(tabsSource).toContain("strip.removeEventListener('wheel', onWheel)");
  });

  test('fades whichever edge hides providers, so clipped tabs have an affordance', () => {
    expect(tabsSource).toContain('data-overflow-start={overflow.start || undefined}');
    expect(tabsSource).toContain('data-overflow-end={overflow.end || undefined}');
    // Re-measured on scroll and on resize, not only once at mount.
    expect(tabsSource).toContain(
      "strip.addEventListener('scroll', syncOverflow, { passive: true })"
    );
    expect(tabsSource).toContain('new ResizeObserver(syncOverflow)');
    expect(tabsStyles).toMatch(/&\[data-overflow-end\]\s*\{\s*mask-image: linear-gradient\(/);
    expect(tabsStyles).toMatch(/&\[data-overflow-start\]\s*\{\s*mask-image: linear-gradient\(/);
  });

  test('reports hidden content per edge with sub-pixel tolerance', () => {
    expect(readStripOverflow({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 })).toEqual({
      start: false,
      end: false,
    });
    // Fractional layout widths never leave a fade on a strip that fits.
    expect(readStripOverflow({ scrollLeft: 0, scrollWidth: 400.6, clientWidth: 400 })).toEqual({
      start: false,
      end: false,
    });
    expect(readStripOverflow({ scrollLeft: 0, scrollWidth: 520, clientWidth: 360 })).toEqual({
      start: false,
      end: true,
    });
    expect(readStripOverflow({ scrollLeft: 80, scrollWidth: 520, clientWidth: 360 })).toEqual({
      start: true,
      end: true,
    });
    expect(readStripOverflow({ scrollLeft: 160, scrollWidth: 520, clientWidth: 360 })).toEqual({
      start: true,
      end: false,
    });
  });

  test('allocates remaining quota toolbar width without shrinking the sort control', () => {
    expect(quotaStyles).toMatch(/\.filters\s*\{[^}]*flex: 1 1 auto;[^}]*min-width: 0;/);
    expect(quotaStyles).toMatch(/\.sort\s*\{\s*flex: 0 0 auto;/);
  });
});

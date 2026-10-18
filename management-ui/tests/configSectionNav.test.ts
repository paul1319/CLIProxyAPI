// Left section index: names each section with its error count and unsaved state, marks the
// active section, and lists the active section's groups as in-page anchors.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { SectionNav, SectionSelect } from '@/features/config/components/SectionNav';
import { CONFIG_SECTION_GROUPS } from '@/features/config/groups';

const noop = () => {};
const translations = i18n.cloneInstance({ lng: 'en' });
const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n: translations }, element));

describe('SectionNav', () => {
  const markup = render(
    createElement(SectionNav, {
      active: 'connectivity',
      errorCounts: { streaming: 2 },
      dirtyTabs: new Set(['streaming'] as const),
      dirtyFieldIds: new Set(['port']),
      errorFieldIds: new Set(['rmSecretKey']),
      activeGroup: 'tls',
      onChange: noop,
    })
  );

  test('announces validation errors and unsaved changes in the section name', () => {
    const accessibleLabel = [
      translations.t('config_management.nav.streaming'),
      translations.t('config_management.save_bar.errors', { count: 2 }),
      translations.t('config_management.status_dirty_short'),
    ].join(', ');
    expect(markup).toContain(`aria-label="${accessibleLabel}"`);
    expect(accessibleLabel).toContain('2 errors');
  });

  test('marks only the active section as current and links it to the content region', () => {
    expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
    const active = markup.match(/<button[^>]*id="config-tab-connectivity"[^>]*>/)?.[0] ?? '';
    expect(active).toContain('aria-current="true"');
    expect(active).toContain('aria-controls="config-panel-connectivity"');
  });

  test('lists the groups of the active section only, with unsaved/error markers', () => {
    for (const group of CONFIG_SECTION_GROUPS.connectivity) {
      expect(markup).toContain(translations.t(group.titleKey));
    }
    expect(markup).not.toContain(`>${translations.t(CONFIG_SECTION_GROUPS.network[0].titleKey)}<`);
    // port (server group) is unsaved; rmSecretKey (remote group) has an error.
    expect(markup).toContain(
      `aria-label="${translations.t('config_management.status_dirty_short')}"`
    );
    expect(markup).toContain(
      `aria-label="${translations.t('config_management.save_bar.errors', { count: 1 })}"`
    );
  });

  test('section and group entries are real buttons', () => {
    const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBe(6 + CONFIG_SECTION_GROUPS.connectivity.length);
    for (const button of buttons) expect(button).toContain('type="button"');
  });
});

describe('SectionSelect', () => {
  test('shows unsaved and error markers in the option label of the current section', () => {
    const markup = render(
      createElement(SectionSelect, {
        active: 'streaming',
        errorCounts: { streaming: 1 },
        dirtyTabs: new Set(['streaming'] as const),
        onChange: noop,
      })
    );
    expect(markup).toContain(
      [
        translations.t('config_management.nav.streaming'),
        translations.t('config_management.status_dirty_short'),
        translations.t('config_management.save_bar.errors', { count: 1 }),
      ].join(' · ')
    );
    expect(markup).toContain(`aria-label="${translations.t('config_management.nav_label')}"`);
  });
});

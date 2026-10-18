import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ModelAdvancedFields } from '@/features/providers/sheets/forms/ModelAdvancedFields';
import type { ProviderBrand } from '@/features/providers/types';

// Keep key-based assertions independent of other suites initializing the app's i18n.
const translations = createInstance();
await translations.init({ lng: 'cimode', resources: {}, react: { useSuspense: false } });

describe('provider model options', () => {
  const render = (brand: ProviderBrand, disabled = false, enabled = true) =>
    renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: translations },
        createElement(ModelAdvancedFields, {
          entry: { name: 'model', thinkingEnabled: enabled },
          providerBrand: brand,
          disabled,
          supportsThinking: true,
          onUpdate: () => {},
        })
      )
    );

  test('gates fields by provider capability', () => {
    const vertex = render('vertex');
    expect(vertex).toContain('providersPage.modelOptions.displayName');
    expect(vertex).toContain('providersPage.modelOptions.forceMapping');
    expect(vertex).not.toContain('providersPage.modelOptions.maxContextLength');
    expect(vertex).not.toContain('providersPage.modelOptions.isCompat');
    for (const brand of ['gemini', 'codex', 'openaiCompatibility'] as const) {
      const html = render(brand);
      expect(html).toContain('providersPage.modelOptions.maxContextLength');
      expect(html).toContain('providersPage.modelOptions.isCompat');
      expect(html.includes('providersPage.modelOptions.supportConfigurationUpdate')).toBe(
        brand === 'codex'
      );
      expect(html.includes('providersPage.modelOptions.inputModalitiesText')).toBe(
        brand === 'openaiCompatibility'
      );
      expect(html.includes('providersPage.modelOptions.useMaxCompletionTokens')).toBe(
        brand === 'openaiCompatibility'
      );
    }
  });

  test('mutating disables every control; default thinking disables budgets and levels', () => {
    const controls =
      render('openaiCompatibility', true).match(/<(?:input|select|button)\b[^>]*>/g) ?? [];
    expect(controls.length).toBeGreaterThan(10);
    for (const control of controls) expect(control).toContain('disabled=""');
    const defaultThinking = render('gemini', false, false).split('<fieldset')[1];
    const inputs = defaultThinking.match(/<(?:input|button)\b[^>]*>/g) ?? [];
    expect(inputs.length).toBeGreaterThan(4);
    const mode = inputs.filter((input) => input.includes('aria-haspopup="listbox"'));
    expect(mode).toHaveLength(1);
    expect(mode[0]).not.toContain('disabled=""');
    for (const input of inputs.filter((input) => !input.includes('aria-haspopup="listbox"'))) {
      expect(input).toContain('disabled=""');
    }
  });
});

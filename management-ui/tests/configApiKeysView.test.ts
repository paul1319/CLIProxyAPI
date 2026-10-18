// Client API keys list and the Proxy URL sponsor link (Server & access / Network sections).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { DEFAULT_VISUAL_VALUES } from '@/types/visualConfig';
import { SectionConnectivity } from '@/features/config/components/sections/SectionConnectivity';
import { SectionNetwork } from '@/features/config/components/sections/SectionNetwork';
import { SPONSORS } from '@/features/config/sponsors';
import { LANGUAGE_ORDER } from '@/utils/constants';

const translations = i18n.cloneInstance({ lng: 'en' });
const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n: translations }, element));
const values = {
  ...DEFAULT_VISUAL_VALUES,
  apiKeysText: 'sk-fixture-alpha-0001\nsk-fixture-beta-0002',
};

describe('client API keys list', () => {
  const markup = render(
    createElement(SectionConnectivity, { values, disabled: false, onChange: () => {} })
  );
  const keyList = markup.split('id="cfg-field-apiKeys"')[1].split('<section id="cfg-group-tls"')[0];

  test('leads each row with the masked key and shows no placeholder name', () => {
    expect(keyList.match(/<li\b/g)).toHaveLength(2);
    // Unnamed keys show nothing in the name slot instead of repeating "Unnamed" on every row.
    expect(keyList).not.toContain(translations.t('config_management.visual.api_keys.unnamed'));
    expect(keyList).not.toContain('sk-fixture-alpha-0001');
    // Row = masked key, then straight to the actions (no name element for unnamed keys).
    expect(keyList).toMatch(/<li[^>]*><code[^>]*>sk\*+01<\/code><span[^>]*><button/);
  });

  test('row actions are labelled icon buttons, disabled with the editor', () => {
    const buttons = keyList.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(6);
    for (const button of buttons) {
      expect(button).toMatch(/aria-label="[^"]+: [^"]+"/);
      expect(button).toContain('title=');
    }
    const disabled = render(
      createElement(SectionConnectivity, { values, disabled: true, onChange: () => {} })
    )
      .split('id="cfg-field-apiKeys"')[1]
      .split('<section id="cfg-group-tls"')[0];
    for (const button of disabled.match(/<button\b[^>]*>/g) ?? []) {
      expect(button).toContain('disabled=""');
    }
  });

  test('the heading copy no longer leaks internals; copy toasts say "copied" for keys', () => {
    for (const locale of LANGUAGE_ORDER) {
      const keys = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'))
        .config_management.visual.api_keys;
      expect(keys.label).not.toContain('access.api-keys');
      expect(keys.hint).not.toMatch(
        /API Key Management|API 密钥管理|API 金鑰管理|API 키 관리|Quản lý API Key|управления API/
      );
      expect(typeof keys.copied).toBe('string');
    }
    const editor = readFileSync(
      'src/features/config/components/blocks/ApiKeysCardEditor.tsx',
      'utf8'
    );
    expect(editor).toContain("'config_management.visual.api_keys.copied'");
    expect(editor).not.toContain('notification.link_copied');
  });
});

describe('proxy sponsor link', () => {
  test('is a plain link in the Proxy URL row of the Network section only', () => {
    const sponsor = SPONSORS[0];
    const network = render(
      createElement(SectionNetwork, {
        values: DEFAULT_VISUAL_VALUES,
        disabled: false,
        onChange: () => {},
      })
    );
    const proxyRow = network.split('id="cfg-field-proxyUrl"')[1].split('id="cfg-field-')[0];
    expect(proxyRow).toContain(`href="${sponsor.url}"`);
    expect(proxyRow).toContain('rel="noopener noreferrer sponsored"');
    expect(proxyRow).not.toContain('<img');
    const connectivity = render(
      createElement(SectionConnectivity, { values, disabled: false, onChange: () => {} })
    );
    expect(connectivity).not.toContain(sponsor.url);
  });
});

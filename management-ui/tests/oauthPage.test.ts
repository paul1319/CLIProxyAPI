import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
import ko from '@/i18n/locales/ko.json';
import vi from '@/i18n/locales/vi.json';
import { OAuthPage } from '@/features/oauth/OAuthPage';
import { OAuthFlowDialog } from '@/features/oauth/components/OAuthFlowDialog';
import { resolveCallbackUrl, XAI_CALLBACK_URL } from '@/features/oauth/callbackUrl';
import { resolveFlowView, splitAuthUrl } from '@/features/oauth/flowView';
import { buildPluginOAuthProviderCards, OAUTH_PROVIDERS } from '@/features/oauth/providers';
import {
  connectedCountFor,
  countCredentialsByProvider,
  credentialProviderKey,
} from '@/features/oauth/connectedCounts';
import type { PluginListEntry } from '@/types';

describe('OAuth dialog view resolution', () => {
  test('maps every flow state to exactly one view', () => {
    expect(resolveFlowView({})).toBe('idle');
    // Generating the link: already in the step view (placeholder)
    expect(resolveFlowView({ status: 'waiting' })).toBe('flow');
    expect(resolveFlowView({ status: 'waiting', url: 'https://a.test' })).toBe('flow');
    expect(resolveFlowView({ status: 'success' })).toBe('success');
    // Polling failed but the link is still valid: stay in the step view, a manual callback can recover
    expect(resolveFlowView({ status: 'error', url: 'https://a.test' })).toBe('flow');
    // The link is gone (start failed / Devin terminal failure): failed view
    expect(resolveFlowView({ status: 'error', error: 'denied' })).toBe('failed');
  });

  test('highlights the host of the authorization link', () => {
    expect(splitAuthUrl('https://auth.openai.com/oauth/authorize?x=1')).toEqual({
      host: 'auth.openai.com',
      rest: '/oauth/authorize?x=1',
    });
    expect(splitAuthUrl('http://127.0.0.1:8317/cb')).toEqual({
      host: '127.0.0.1:8317',
      rest: '/cb',
    });
    expect(splitAuthUrl('not a url')).toEqual({ host: '', rest: 'not a url' });
  });
});

describe('manual callback input', () => {
  test('submits non-xAI input verbatim (trimmed)', () => {
    expect(resolveCallbackUrl('codex', '  http://localhost:1455/auth/callback?code=c  ')).toBe(
      'http://localhost:1455/auth/callback?code=c'
    );
  });

  test('passes absolute xAI callback URLs through', () => {
    const url = 'http://127.0.0.1:56121/callback?code=c&state=s';
    expect(resolveCallbackUrl('xai', url, 'other')).toBe(url);
  });

  test('builds the xAI loopback URL from a displayed code and the attempt state', () => {
    const built = new URL(resolveCallbackUrl('xai', 'abc123', 'st-1')!);
    expect(`${built.origin}${built.pathname}`).toBe(XAI_CALLBACK_URL);
    expect(built.searchParams.get('code')).toBe('abc123');
    expect(built.searchParams.get('state')).toBe('st-1');
    expect(new URL(resolveCallbackUrl('xai', 'code: xyz', 'st-1')!).searchParams.get('code')).toBe(
      'xyz'
    );
  });

  test('prefers the pasted query state and keeps provider errors', () => {
    const built = new URL(
      resolveCallbackUrl('xai', '?error=access_denied&error_description=no&state=pasted', 'st')!
    );
    expect(built.searchParams.get('state')).toBe('pasted');
    expect(built.searchParams.get('error')).toBe('access_denied');
    expect(built.searchParams.get('error_description')).toBe('no');
  });

  test('refuses to invent a state for xAI', () => {
    expect(resolveCallbackUrl('xai', 'abc123')).toBeNull();
    expect(resolveCallbackUrl('xai', 'code=abc123')).toBeNull();
    expect(resolveCallbackUrl('xai', '   ', 'st')).toBeNull();
  });
});

const plugin = (overrides: Partial<PluginListEntry>): PluginListEntry => ({
  id: 'example',
  path: '/plugins/example',
  configured: true,
  registered: true,
  enabled: true,
  effectiveEnabled: true,
  supportsOAuth: true,
  oauthProvider: 'example',
  supportsQuota: false,
  logo: '',
  configFields: [],
  menus: [],
  metadata: null,
  ...overrides,
});

describe('plugin OAuth tiles', () => {
  test('appends enabled OAuth plugins once and never shadows built-in providers', () => {
    const cards = buildPluginOAuthProviderCards(
      [
        plugin({ id: 'a', oauthProvider: 'acme' }),
        plugin({ id: 'a-dup', oauthProvider: 'acme' }),
        plugin({ id: 'b', oauthProvider: 'codex' }),
        plugin({ id: 'c', oauthProvider: 'off', effectiveEnabled: false }),
        plugin({ id: 'd', oauthProvider: 'nooauth', supportsOAuth: false }),
        plugin({ id: 'e', oauthProvider: undefined }),
      ],
      'http://127.0.0.1:8317'
    );
    expect(cards.map((card) => [card.id, card.title])).toEqual([['acme', 'a']]);
  });
});

describe('connected credential counts', () => {
  test('groups credentials by normalized provider and keeps Kimi sites apart', () => {
    const counts = countCredentialsByProvider([
      { provider: 'codex' },
      { provider: 'codex' },
      { provider: 'claude' },
      { type: 'anthropic' },
      { provider: 'kimi' },
      { provider: 'kimi_ai' },
      { provider: 'x-ai' },
      { type: 'grok' },
      { provider: 'vertex' },
      { provider: '' },
      {},
    ]);
    expect(counts).toEqual({ codex: 2, claude: 2, kimi: 1, 'kimi-ai': 1, xai: 2, vertex: 1 });
  });

  test('maps OAuth provider ids onto credential provider keys', () => {
    const counts = countCredentialsByProvider([{ provider: 'claude' }, { provider: 'acme' }]);
    // Sign-in uses `anthropic`, credentials are stored as `claude`.
    expect(connectedCountFor(counts, 'anthropic')).toBe(1);
    expect(connectedCountFor(counts, 'acme')).toBe(1);
    expect(connectedCountFor(counts, 'devin')).toBe(0);
    expect(credentialProviderKey({ provider: ' XAI ' })).toBe('xai');
  });
});

const renderPage = async (lng: string, translation: object) => {
  const i18n = createInstance();
  await i18n.init({ lng, resources: { [lng]: { translation } } });
  const markup = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(MemoryRouter, null, createElement(OAuthPage))
    )
  );
  return { i18n, markup };
};

describe('Add account picker', () => {
  const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, ko, vi } as const;

  for (const [lng, translation] of Object.entries(locales)) {
    test(`renders every provider row without raw keys (${lng})`, async () => {
      const { i18n, markup } = await renderPage(lng, translation);
      for (const provider of OAUTH_PROVIDERS) {
        const label =
          typeof provider.label === 'string' ? provider.label : i18n.t(provider.label.key);
        expect(markup).toContain(label);
      }
      expect(markup).toContain('Vertex AI');
      expect(markup).toContain(i18n.t('auth_login.credential_file_title'));
      expect(markup).not.toMatch(/auth_login\.|vertex_import\./);
      // One dialog-opening button per provider site, plus the Vertex import.
      // The credential-file row is a plain link and must not claim a dialog.
      expect(markup.match(/aria-haspopup="dialog"/g)?.length).toBe(OAUTH_PROVIDERS.length + 1);
    });
  }

  test('uses the shared page header and two picker groups', async () => {
    const { markup } = await renderPage('en', en);
    expect(markup).toContain(`<h1`);
    expect(markup).toContain(en.nav.oauth);
    expect(markup).toContain(en.auth_login.page_meta);
    expect(markup).toContain(en.auth_login.group_sign_in);
    expect(markup).toContain(en.auth_login.group_import);
    // The old "N providers" headline carried no information.
    expect(markup).not.toContain('8 providers');
  });

  test('names each Connect button after its provider and links file import to Credentials', async () => {
    const { markup } = await renderPage('en', en);
    // Visible label stays a short verb; aria-labelledby appends the provider name.
    const connectButtons = markup.match(/<button[^>]*aria-labelledby="[^"]+ [^"]+"[^>]*>/g) ?? [];
    expect(connectButtons.length).toBe(OAUTH_PROVIDERS.length + 1);
    expect(markup.match(new RegExp(`>${en.auth_login.connect}</button>`, 'g'))?.length).toBe(
      OAUTH_PROVIDERS.length
    );
    expect(markup).toMatch(/<a[^>]*href="\/auth-files"[^>]*>/);
    expect(markup).toContain(en.auth_login.credential_file_action);
  });

  test('lists both Kimi sites as ordinary sign-in rows', async () => {
    const { markup } = await renderPage('zh-CN', zhCN);
    expect(markup).not.toContain('role="group"');
    expect(markup).toContain(`>${zhCN.auth_login.kimi_oauth_name}<`);
    expect(markup).toContain(`>${zhCN.auth_login.kimi_ai_oauth_name}<`);
    expect(markup).toContain('kimi.com · ');
    expect(markup).toContain('kimi.ai · ');
  });

  test('carries no sponsorship or affiliate links', async () => {
    for (const [locale, translation] of [
      ['en', en],
      ['zh-CN', zhCN],
    ] as const) {
      const { markup } = await renderPage(locale, translation);
      expect(markup).not.toContain('platform.kimi.');
      expect(markup).not.toContain('aff=');
      expect(markup).not.toMatch(/sponsor/i);
    }
    for (const translation of Object.values(locales)) {
      const messages = translation.auth_login as Record<string, string>;
      expect(messages.sponsored).toBeUndefined();
      expect(messages.kimi_sign_up_button).toBeUndefined();
    }
  });

  test('keeps the picker static and on system tokens', () => {
    const styles = readFileSync('src/features/oauth/components/ProviderPicker.module.scss', 'utf8');
    // No light pools, no keyframes, no brand tint.
    expect(styles).not.toMatch(/@keyframes|animation\s*:/);
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(styles).not.toContain('pool');
  });

  test('tells the truth about background sign-in', () => {
    // Flows poll while the page is mounted; leaving the page stops them.
    for (const translation of Object.values(locales)) {
      expect(translation.auth_login.waiting_background_hint).toBeTruthy();
    }
    expect(en.auth_login.waiting_background_hint).toMatch(/keep this page open/i);
    expect(en.auth_login.waiting_background_hint).not.toMatch(/won't stop/i);
  });
});

describe('sign-in dialog', () => {
  test('renders numbered steps, the emphasized host and a live status line', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(OAuthFlowDialog, {
          open: true,
          providerId: 'codex',
          heading: { title: en.auth_login.codex_oauth_title, caption: 'Browser sign-in', icon: '' },
          state: {
            status: 'waiting',
            url: 'https://auth.openai.com/oauth/authorize?client_id=x',
            state: 'st',
          },
          text: (suffix: string) => i18n.t(`auth_login.codex_${suffix}`),
          supportsCallback: true,
          onStart: () => {},
          onCancel: () => {},
          onCallbackChange: () => {},
          onCallbackSubmit: () => {},
          onViewAuthFiles: () => {},
          onClose: () => {},
        })
      )
    );
    // Step 1 (open page) and step 3 (callback); no device code for Codex.
    expect(markup.match(/<li/g)?.length).toBe(2);
    expect(markup).toContain('>auth.openai.com</span>');
    expect(markup).toContain(en.auth_login.codex_open_link);
    expect(markup).toContain(en.auth_login.codex_copy_link);
    expect(markup).not.toContain(en.auth_login.step_enter_device_code);
    expect(markup).toContain(en.auth_login.codex_oauth_status_waiting);
    expect(markup).toContain(en.auth_login.waiting_background_hint);
    expect(markup).toMatch(/role="status" aria-live="polite"/);
  });
});

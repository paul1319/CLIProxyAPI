// Save bar: only rendered while there are unsaved changes; summarizes what changed, surfaces
// blocking errors with a jump, and offers Discard + Review & save with the shortcut hint.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { SaveBar, type SaveBarProps } from '@/features/config/components/SaveBar';
import { isModShortcut, modShortcutLabel } from '@/features/config/shortcuts';

const translations = i18n.cloneInstance({ lng: 'en' });
const noop = () => {};
const base: SaveBarProps = {
  visible: true,
  changes: [
    { fieldId: 'host', label: 'Host Address', section: 'Server & access' },
    { fieldId: 'port', label: 'Port', section: 'Server & access' },
  ],
  sourceDirty: false,
  errorCount: 0,
  saving: false,
  saveDisabled: false,
  discardDisabled: false,
  shortcutLabel: '⌘S',
  onSave: noop,
  onDiscard: noop,
  onGoToError: noop,
};
const render = (props: Partial<SaveBarProps> = {}) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: translations },
      createElement(SaveBar, { ...base, ...props })
    )
  );

describe('SaveBar', () => {
  test('renders nothing while there is nothing to save', () => {
    expect(render({ visible: false })).toBe('');
  });

  test('summarizes the change count and offers discard and review with the shortcut', () => {
    const markup = render();
    expect(markup).toContain('2 unsaved changes');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('>Discard<');
    expect(markup).toContain('Review &amp; save');
    expect(markup).toContain('<kbd');
    expect(markup).toContain('⌘S');
    expect(render({ changes: base.changes.slice(0, 1) })).toContain('1 unsaved change<');
  });

  test('shows blocking errors with a jump and keeps save disabled', () => {
    const markup = render({ errorCount: 1, saveDisabled: true });
    expect(markup).toContain('1 error<');
    expect(markup).toContain('>Go to</button>');
    const save = markup.match(/<button[^>]*class="btn btn-primary[^"]*"[^>]*>/)?.[0] ?? '';
    expect(save).toContain('disabled=""');
  });

  test('source drafts and blocking statuses replace the field summary', () => {
    expect(render({ sourceDirty: true })).toContain(
      translations.t('config_management.meta_dirty_source')
    );
    const status = render({ statusText: 'Saving configuration...', statusTone: 'busy' });
    expect(status).toContain('Saving configuration...');
    expect(status).not.toContain('aria-expanded');
  });
});

describe('page wiring', () => {
  const page = readFileSync('src/features/config/ConfigPage.tsx', 'utf8');

  test('guards unsaved edits on tab close and registers the shell refresh', () => {
    expect(page).toContain("window.addEventListener('beforeunload'");
    expect(page).toContain('useHeaderRefresh(handleHeaderRefresh, isCurrentLayer)');
  });

  test('the save bar is visible only while the page is current and dirty', () => {
    expect(page).toContain('visible={isCurrentLayer && doc.isDirty}');
    const bar = readFileSync('src/features/config/components/SaveBar.tsx', 'utf8');
    expect(bar).toContain("useActionBarHeightVar(barRef, '--config-action-bar-height', visible)");
  });
});

describe('shortcuts', () => {
  const key = (init: Partial<KeyboardEvent>) =>
    ({
      key: 's',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...init,
    }) as KeyboardEvent;

  test('Mod+S / Mod+K accept Cmd or Ctrl and ignore other modifiers', () => {
    expect(isModShortcut(key({ metaKey: true }), 's')).toBe(true);
    expect(isModShortcut(key({ ctrlKey: true, key: 'S' }), 's')).toBe(true);
    expect(isModShortcut(key({ metaKey: true, shiftKey: true }), 's')).toBe(false);
    expect(isModShortcut(key({}), 's')).toBe(false);
    expect(isModShortcut(key({ metaKey: true, key: 'k' }), 'k')).toBe(true);
  });

  test('labels follow the platform', () => {
    expect(modShortcutLabel('s', true)).toBe('⌘S');
    expect(modShortcutLabel('k', false)).toBe('Ctrl+K');
  });
});

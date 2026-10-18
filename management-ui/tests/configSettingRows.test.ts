// Setting row primitives: toggles, inputs, selects and block editors share one skeleton (one
// setting per row), show the YAML key from the search index, mark unsaved rows, and wire labels,
// hints and errors for assistive tech.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import {
  BlockSetting,
  SelectSetting,
  SettingGroup,
  TextSetting,
  ToggleSetting,
} from '@/features/config/components/fields/FieldPrimitives';
import { DirtyFieldsContext } from '@/features/config/components/fields/settingState';

const noop = () => {};
const translations = i18n.cloneInstance({ lng: 'en' });
const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n: translations }, element));
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const rowTag = (markup: string, fieldId: string) =>
  markup.match(new RegExp(`<div id="cfg-field-${fieldId}"[^>]*>`))?.[0] ?? '';

describe('setting groups', () => {
  test('render the registry title as a heading above the list, plus description and actions', () => {
    const markup = render(
      createElement(
        SettingGroup,
        {
          group: 'tls',
          description: 'Group hint',
          actions: createElement('button', { type: 'button' }, 'Act'),
        },
        createElement('i', null, 'row')
      )
    );
    expect(markup).toContain('<section id="cfg-group-tls"');
    expect(markup).toContain('aria-labelledby="cfg-group-tls-title"');
    expect(markup).toMatch(/<h3 id="cfg-group-tls-title"[^>]*>TLS<\/h3>/);
    expect(markup).toContain('Group hint');
    expect(markup).toContain('>Act</button>');
  });

  test('an explicit title overrides the registry', () => {
    const markup = render(createElement(SettingGroup, { group: 'tls', title: 'Custom' }, 'x'));
    expect(markup).toContain('>Custom</h3>');
  });
});

describe('row state', () => {
  test('rows show their YAML key from the search index', () => {
    const markup = render(
      createElement(TextSetting, { fieldId: 'port', label: 'Port', value: '', onChange: noop })
    );
    expect(markup).toContain('>server.port</code>');
  });

  test('unsaved rows are marked from the dirty field context; others are not', () => {
    const markup = render(
      createElement(
        DirtyFieldsContext.Provider,
        { value: new Set(['debug']) },
        createElement(ToggleSetting, {
          fieldId: 'debug',
          label: 'Debug',
          checked: false,
          onChange: noop,
        }),
        createElement(ToggleSetting, {
          fieldId: 'loggingToFile',
          label: 'Log to file',
          checked: false,
          onChange: noop,
        })
      )
    );
    expect(rowTag(markup, 'debug')).toContain('data-dirty="true"');
    expect(rowTag(markup, 'loggingToFile')).not.toContain('data-dirty');
  });
});

describe('setting row accessibility', () => {
  test('toggle rows label the switch and describe it with the hint', () => {
    const markup = render(
      createElement(ToggleSetting, {
        fieldId: 'debug',
        label: 'Debug',
        description: 'Verbose logs',
        checked: true,
        onChange: noop,
      })
    );
    expect(markup).toContain('id="cfg-field-debug"');
    const input = markup.match(/<input\b[^>]*type="checkbox"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('checked=""');
    const id = attr(input, 'id');
    expect(id).toBeTruthy();
    expect(markup).toContain(`for="${id}"`);
    expect(attr(input, 'aria-describedby')).toBe(`${id}-hint`);
    expect(markup).toContain(`id="${id}-hint"`);
  });

  test('text rows put the error before the hint and flag the input invalid', () => {
    const markup = render(
      createElement(TextSetting, {
        fieldId: 'port',
        label: 'Port',
        description: 'Listen port',
        error: 'Invalid port',
        type: 'number',
        value: '',
        onChange: noop,
        disabled: true,
      })
    );
    const input = markup.match(/<input\b[^>]*>/)?.[0] ?? '';
    const id = attr(input, 'id');
    expect(markup).toContain(`for="${id}"`);
    expect(attr(input, 'aria-describedby')).toBe(`${id}-error ${id}-hint`);
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('type="number"');
    expect(input).toContain('disabled=""');
    expect(input).not.toContain('min=');
    expect(markup).toContain('Invalid port');
  });

  test('adornments render inside the control without replacing the value', () => {
    const markup = render(
      createElement(TextSetting, {
        fieldId: 'streamingKeepaliveSeconds',
        label: 'Keepalive',
        value: '0',
        adornment: 'Disabled',
        onChange: noop,
      })
    );
    expect(markup).toContain('value="0"');
    expect(markup).toContain('Disabled');
    expect(markup).not.toContain('aria-describedby');
  });

  test('select rows label the trigger button by id and by aria-labelledby', () => {
    const markup = render(
      createElement(SelectSetting, {
        fieldId: 'routingStrategy',
        label: 'Strategy',
        value: 'a',
        options: [
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ],
        onChange: noop,
      })
    );
    const button = markup.match(/<button\b[^>]*aria-haspopup="listbox"[^>]*>/)?.[0] ?? '';
    const id = attr(button, 'id');
    expect(markup).toContain(`for="${id}"`);
    const labelId = attr(button, 'aria-labelledby');
    expect(labelId).toContain('routingStrategy-label');
    expect(markup).toContain(`id="${labelId}"`);
    expect(markup).toContain('Alpha');
  });

  test('block rows wrap the editor in a named group and hand describedBy to it', () => {
    let received: { describedBy?: string; invalid: boolean } | undefined;
    const markup = render(
      createElement(BlockSetting, {
        fieldId: 'trustedProxies',
        label: 'Trusted proxies',
        description: 'CIDR list',
        error: 'Bad CIDR',
        children: (a11y: { describedBy?: string; invalid: boolean }) => {
          received = a11y;
          return createElement('textarea', { 'aria-describedby': a11y.describedBy });
        },
      })
    );
    const group = markup.match(/<div\b[^>]*role="group"[^>]*>/)?.[0] ?? '';
    const labelId = attr(group, 'aria-labelledby') ?? '';
    expect(labelId).toContain('trustedProxies-label');
    expect(markup).toContain(`id="${labelId}"`);
    expect(group).toContain('aria-invalid="true"');
    expect(received?.invalid).toBe(true);
    const ids = received?.describedBy?.split(' ') ?? [];
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(markup).toContain(`id="${id}"`);
    expect(attr(group, 'aria-describedby')).toBe(received?.describedBy);
  });
});

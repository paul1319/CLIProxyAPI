// One setting per row, grouped: every section renders its settings as headed groups in the order
// of the group registry (groups.ts), each group lists exactly its registered fields, and every
// field anchor appears once. The section index (group anchors, unsaved dots) relies on this.

import { describe, expect, mock, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_VISUAL_VALUES } from '@/types/visualConfig';
import { CONFIG_SECTION_IDS } from '@/features/config/constants';
import { CONFIG_SECTION_GROUPS } from '@/features/config/groups';
import { CONFIG_FIELD_SEARCH_INDEX } from '@/features/config/searchIndex';

// Bun resolves CSS modules to path strings (class names undefined); echo the original names so the
// markup shows row / list classes.
mock.module(
  join(import.meta.dir, '../src/features/config/components/fields/Field.module.scss'),
  () => ({
    default: new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : undefined) }),
  })
);

const { I18nextProvider } = await import('react-i18next');
const { default: i18n } = await import('@/i18n');
const sections = {
  connectivity: (await import('@/features/config/components/sections/SectionConnectivity'))
    .SectionConnectivity,
  network: (await import('@/features/config/components/sections/SectionNetwork')).SectionNetwork,
  logging: (await import('@/features/config/components/sections/SectionLogging')).SectionLogging,
  streaming: (await import('@/features/config/components/sections/SectionStreaming'))
    .SectionStreaming,
  advanced: (await import('@/features/config/components/sections/SectionAdvanced')).SectionAdvanced,
  payload: (await import('@/features/config/components/sections/SectionPayload')).SectionPayload,
} as Record<string, ComponentType<Record<string, unknown>>>;

const translations = i18n.cloneInstance({ lng: 'en' });
const render = (Section: ComponentType<Record<string, unknown>>, tlsEnable: boolean) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: translations },
      createElement(Section, {
        values: { ...DEFAULT_VISUAL_VALUES, tlsEnable },
        disabled: false,
        hasPayloadValidationErrors: false,
        onChange: () => {},
      })
    )
  );

/** Group ids in render order, each with the field anchors rendered inside it. */
function groupsOf(markup: string) {
  return markup
    .split('<section id="cfg-group-')
    .slice(1)
    .map((chunk) => ({
      id: chunk.slice(0, chunk.indexOf('"')),
      fields: [...chunk.matchAll(/id="cfg-field-([^"]+)"/g)].map(([, fieldId]) => fieldId),
    }));
}

const TLS_DEPENDENT = new Set(['tlsCert', 'tlsKey']);

describe('grouped one-per-row layout', () => {
  for (const sectionId of CONFIG_SECTION_IDS) {
    for (const tlsEnable of sectionId === 'connectivity' ? [false, true] : [false]) {
      test(`${sectionId}${tlsEnable ? ' (TLS on)' : ''}: groups follow the registry`, () => {
        const markup = render(sections[sectionId], tlsEnable);
        const registry = CONFIG_SECTION_GROUPS[sectionId];
        const groups = groupsOf(markup);
        expect(groups.map((group) => group.id)).toEqual(registry.map((group) => group.id));
        for (const [index, group] of groups.entries()) {
          const expected = registry[index].fields.filter(
            (fieldId) => tlsEnable || !TLS_DEPENDENT.has(fieldId)
          );
          expect(group.fields).toEqual(expected);
        }
        for (const fieldId of groups.flatMap((group) => group.fields)) {
          expect(markup.split(`id="cfg-field-${fieldId}"`)).toHaveLength(2);
        }
      });
    }
  }

  test('setting rows are full-width list items, never paired into columns', () => {
    expect(
      existsSync(join(import.meta.dir, '../src/features/config/components/fields/rowSpans.ts'))
    ).toBe(false);
    for (const sectionId of ['connectivity', 'network', 'advanced']) {
      const markup = render(sections[sectionId], true);
      expect(markup).not.toContain('rowWide');
      const rows = [...markup.matchAll(/<div id="cfg-field-[^"]+" class="([^"]*)"/g)].map(
        ([, classes]) => classes.split(' ')
      );
      expect(rows.length).toBeGreaterThan(5);
      for (const classes of rows) {
        expect(classes.includes('row') || classes.includes('cell')).toBe(true);
      }
    }
  });

  test('the group registry covers every search index field exactly once, in its own section', () => {
    const registered = CONFIG_SECTION_IDS.flatMap((sectionId) =>
      CONFIG_SECTION_GROUPS[sectionId].flatMap((group) =>
        group.fields.map((fieldId) => ({ fieldId, sectionId }))
      )
    );
    expect(new Set(registered.map((entry) => entry.fieldId)).size).toBe(registered.length);
    expect(registered.map((entry) => entry.fieldId).sort()).toEqual(
      CONFIG_FIELD_SEARCH_INDEX.map((entry) => entry.fieldId).sort()
    );
    for (const entry of CONFIG_FIELD_SEARCH_INDEX) {
      expect(registered.find((item) => item.fieldId === entry.fieldId)?.sectionId).toBe(
        entry.sectionId
      );
    }
  });

  test('group ids are unique and every group title resolves in en.json', () => {
    const groups = Object.values(CONFIG_SECTION_GROUPS).flat();
    expect(new Set(groups.map((group) => group.id)).size).toBe(groups.length);
    for (const group of groups) {
      expect(translations.exists(group.titleKey)).toBe(true);
    }
  });
});

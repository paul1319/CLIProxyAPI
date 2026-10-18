// YAML source editor theme: token-based (CSS variables), never CodeMirror's stock light/dark,
// whose red/green token colors collide with the state colors.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const editor = readFileSync('src/features/config/components/ConfigSourceEditor.tsx', 'utf8');
const theme = readFileSync('src/features/config/components/sourceEditorTheme.ts', 'utf8');

describe('YAML source editor theme', () => {
  test('the editor passes the token theme instead of the stock light/dark themes', () => {
    expect(editor).toContain('sourceEditorTheme(');
    expect(editor).toContain('theme={editorTheme}');
    expect(editor).not.toContain('theme={theme}');
    expect(editor).not.toContain('theme-one-dark');
  });

  test('colors come from design tokens only', () => {
    expect(theme).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(theme).toContain("tags.definition(tags.propertyName), color: 'var(--ink-2)'");
    expect(theme).toContain("color: 'var(--ink-3)', fontStyle: 'italic'");
    expect(theme).toContain("'.cm-yaml-scalar, .cm-yaml-scalar > span': { color: 'var(--focus)' }");
    expect(theme).toContain("backgroundColor: 'var(--well)'");
    expect(theme).not.toMatch(/--signal-(ok|warn)/);
  });
});

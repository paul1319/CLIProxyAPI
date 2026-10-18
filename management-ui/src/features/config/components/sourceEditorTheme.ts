// Token-based CodeMirror theme for the YAML source editor. Every color is a design-system CSS
// variable, so light and dark are one theme and follow the token swap; red/green stay reserved for
// state. Keys ink-2/500 · strings and plain values ink (plain values inherit) · numbers, booleans
// and null focus · comments ink-3 italic · gutter on the well with ink-4 line numbers ·
// focus-tinted selection.

import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';

const SELECTION = 'color-mix(in srgb, var(--focus) 22%, transparent)';

const chrome = (dark: boolean) =>
  EditorView.theme(
    {
      '&': { color: 'var(--ink)', backgroundColor: 'transparent' },
      '.cm-content': { caretColor: 'var(--ink)' },
      '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--ink)' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        { backgroundColor: SELECTION },
      '.cm-gutters': {
        backgroundColor: 'var(--well)',
        color: 'var(--ink-4)',
        borderRight: '1px solid var(--rule)',
      },
      '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--ink) 4%, transparent)' },
      '.cm-activeLineGutter': { backgroundColor: 'var(--well-strong)', color: 'var(--ink-2)' },
      '.cm-selectionMatch': {
        backgroundColor: 'color-mix(in srgb, var(--focus) 12%, transparent)',
      },
      '&.cm-focused .cm-matchingBracket': {
        backgroundColor: 'transparent',
        outline: '1px solid var(--rule-ink)',
      },
      '&.cm-focused .cm-nonmatchingBracket': {
        backgroundColor: 'transparent',
        color: 'var(--signal-fault-ink)',
      },
      '.cm-foldGutter .cm-gutterElement': { color: 'var(--ink-3)' },
      '.cm-foldPlaceholder': {
        margin: '0 2px',
        padding: '0 4px',
        border: 'none',
        borderRadius: '4px',
        backgroundColor: 'var(--well-strong)',
        color: 'var(--ink-3)',
      },
      '.cm-placeholder': { color: 'var(--ink-4)' },
      // The typed-scalar mark can wrap a highlight span; color both so the mark wins.
      '.cm-yaml-scalar, .cm-yaml-scalar > span': { color: 'var(--focus)' },
    },
    { dark }
  );

const yamlHighlight = HighlightStyle.define([
  { tag: tags.definition(tags.propertyName), color: 'var(--ink-2)', fontWeight: '500' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--ink)' },
  { tag: [tags.lineComment, tags.comment], color: 'var(--ink-3)', fontStyle: 'italic' },
  {
    tag: [tags.separator, tags.punctuation, tags.squareBracket, tags.brace],
    color: 'var(--ink-3)',
  },
  { tag: [tags.labelName, tags.typeName, tags.attributeValue], color: 'var(--ink-2)' },
  { tag: [tags.meta, tags.keyword], color: 'var(--ink-3)' },
]);

// The YAML grammar tags every plain scalar as `content`; numbers, booleans and null are picked
// out here so they read as typed values. YAML 1.2 core schema (what the Go loader uses).
const TYPED_SCALAR =
  /^(?:true|false|null|~|[-+]?(?:\.inf|\.nan)|[-+]?(?:0x[0-9a-f]+|0o[0-7]+|\d[\d_]*(?:\.\d*)?(?:e[-+]?\d+)?|\.\d+(?:e[-+]?\d+)?))$/i;
const scalarMark = Decoration.mark({ class: 'cm-yaml-scalar' });

function typedScalarDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  let lastTo = -1;
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'Literal' || node.from < lastTo) return;
        if (node.node.parent?.name === 'Key') return;
        const text = view.state.doc.sliceString(node.from, node.to).trim();
        if (!TYPED_SCALAR.test(text)) return;
        builder.add(node.from, node.to, scalarMark);
        lastTo = node.to;
      },
    });
  }
  return builder.finish();
}

const typedScalars = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = typedScalarDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = typedScalarDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

/** Theme + highlighting for the YAML editor; `dark` only switches CodeMirror's base defaults. */
export function sourceEditorTheme(dark: boolean): Extension {
  return [chrome(dark), syntaxHighlighting(yamlHighlight), typedScalars];
}

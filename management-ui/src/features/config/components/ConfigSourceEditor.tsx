import { useMemo, type Ref } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { sourceEditorTheme } from './sourceEditorTheme';

type ConfigSourceEditorProps = {
  value: string;
  onChange: (value: string) => void;
  editorRef?: Ref<ReactCodeMirrorRef>;
  theme: 'light' | 'dark';
  editable: boolean;
  placeholder: string;
  /** Mod-F inside the editor: hand over to the page's single YAML search box. */
  onFindShortcut?: () => void;
};

export default function ConfigSourceEditor({
  value,
  onChange,
  editorRef,
  theme,
  editable,
  placeholder,
  onFindShortcut,
}: ConfigSourceEditorProps) {
  // CodeMirror's own search panel is intentionally not loaded: the header search box is the only
  // search UI, so Mod-F is routed there instead of opening a second panel.
  // Token-based theme instead of CodeMirror's stock light/dark (their red/green token colors
  // collide with the state colors); CSS variables make one theme follow both appearances.
  const editorTheme = useMemo(() => sourceEditorTheme(theme === 'dark'), [theme]);
  const extensions = useMemo(
    () => [
      yaml(),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-f',
            run: () => {
              onFindShortcut?.();
              return true;
            },
          },
        ])
      ),
    ],
    [onFindShortcut]
  );

  return (
    <CodeMirror
      ref={editorRef}
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={editorTheme}
      editable={editable}
      placeholder={placeholder}
      height="100%"
      style={{ height: '100%' }}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLineGutter: true,
        highlightActiveLine: true,
        foldGutter: true,
        dropCursor: true,
        allowMultipleSelections: true,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: false,
        rectangularSelection: true,
        crosshairCursor: false,
        highlightSelectionMatches: true,
        closeBracketsKeymap: true,
        searchKeymap: false,
        foldKeymap: true,
        completionKeymap: false,
        lintKeymap: true,
      }}
    />
  );
}

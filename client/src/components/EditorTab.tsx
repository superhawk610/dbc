import { Editor as MonacoEditor } from "@monaco-editor/react";
import { editor as editorNS } from "monaco-editor";
import { MonacoRef } from "./Editor.tsx";

const EDITOR_OPTIONS: editorNS.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  fontSize: 15,
  minimap: {
    enabled: false,
  },
};

export interface Props {
  theme: string;
  defaultValue: string;
  monacoRef: MonacoRef;
  onClickLabel?: string;
  onClick?: () => void;
}

export default function ({
  theme,
  defaultValue,
  monacoRef,
  onClickLabel,
  onClick,
}: Props) {
  return (
    <MonacoEditor
      theme={theme}
      defaultLanguage="sql"
      defaultValue={defaultValue}
      options={EDITOR_OPTIONS}
      onMount={(editor: editorNS.IStandaloneCodeEditor) => {
        monacoRef.editor = editor;
        editor.setPosition({ lineNumber: 2, column: 0 });
        editor.focus();

        if (onClickLabel) {
          editor.addAction({
            id: "editor-action",
            label: onClickLabel,
            keybindings: [
              monacoRef.monaco.KeyMod.CtrlCmd |
              monacoRef.monaco.KeyCode.Enter,
            ],
            contextMenuGroupId: "2_commands",
            run: () => {
              onClick?.();
            },
          });
        }
      }}
    />
  );
}

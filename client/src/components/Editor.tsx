import { forwardRef, useImperativeHandle, useRef } from "react";
import MonacoEditor from "@monaco-editor/react";

export default forwardRef(function Editor(_props, ref) {
  const editorRef = useRef<any | null>(null);

  useImperativeHandle(ref, () => ({
    getContents: () => editorRef.current!.getValue(),
  }));

  return (
    <div style={{ height: "30vh", flex: 0 }}>
      <MonacoEditor
        height="30vh"
        theme="vs-dark"
        defaultLanguage="sql"
        defaultValue="-- type something here"
        onMount={(editor) => {
          editorRef.current = editor;
        }}
      />
    </div>
  );
});

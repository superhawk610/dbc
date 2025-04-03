import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Editor as MonacoEditor, loader, Monaco } from "@monaco-editor/react";
import { editor as editorNS } from "monaco-editor";

const THEME_LIST_JSON = "https://unpkg.com/monaco-themes/themes/themelist.json";

const DEFAULT_THEMES = {
  "vs-dark": "Default (Dark)",
  "vs-light": "Default (Light)",
};

interface MonacoRef {
  editor: editorNS.IStandaloneCodeEditor;
  monaco: Monaco;
  definedThemes: Record<string, boolean>;
}

async function fetchTheme(theme: string, filename: string, ref: MonacoRef) {
  if (!(theme in DEFAULT_THEMES) && !ref.definedThemes[theme]) {
    const url = `https://unpkg.com/monaco-themes/themes/${filename}.json`;
    const res = await fetch(url);
    const themeJson = await res.json();
    ref.monaco.editor.defineTheme(theme, themeJson);
    ref.definedThemes[theme] = true;
  }
}

export interface Props {
  onClick?: () => void;
  onClickLabel?: string;
}

export default forwardRef(
  function Editor({ onClick, onClickLabel }: Props, ref) {
    const [showEditor, setShowEditor] = useState(false);
    const monacoRef = useRef({ definedThemes: {} } as MonacoRef);
    const [themes, setThemes] = useState<Record<string, string>>(
      DEFAULT_THEMES,
    );
    const [activeTheme, setActiveTheme] = useState(
      globalThis.localStorage.getItem("monaco-theme") ?? "vs-dark",
    );

    useImperativeHandle(ref, () => ({
      getContents: () => monacoRef.current.editor.getValue(),
    }));

    useEffect(() => {
      (async () => {
        monacoRef.current.monaco = await loader.init();

        const res = await fetch(THEME_LIST_JSON);
        const data = await res.json();
        const themes = { ...DEFAULT_THEMES, ...data };
        setThemes(themes);

        // fetch the active theme, in case it's not already cached
        await fetchTheme(activeTheme, themes[activeTheme], monacoRef.current);

        setShowEditor(true);
      })();
    }, []);

    return (
      <>
        <div style={{ height: "30vh", flex: 0 }}>
          {showEditor
            ? (
              <MonacoEditor
                height="30vh"
                theme={activeTheme}
                defaultLanguage="sql"
                defaultValue="-- enter query here"
                options={{
                  fontSize: 15,
                  minimap: {
                    enabled: false,
                  },
                }}
                onMount={(editor: editorNS.IStandaloneCodeEditor) => {
                  monacoRef.current.editor = editor;

                  if (onClickLabel) {
                    editor.addAction({
                      id: "editor-action",
                      label: onClickLabel,
                      keybindings: [
                        monacoRef.current.monaco.KeyMod.CtrlCmd |
                        monacoRef.current.monaco.KeyCode.Enter,
                      ],
                      contextMenuGroupId: "2_commands",
                      run: () => {
                        onClick?.();
                      },
                    });
                  }
                }}
              />
            )
            : <div style={{ height: "30vh" }} />}
        </div>

        <div className="flex flex-row justify-between gap-1 py-2 px-4">
          <div>
            <select
              className="select select-xs select-ghost m-2"
              value={activeTheme}
              onChange={async (e) => {
                const newTheme = e.target.value;
                await fetchTheme(
                  newTheme,
                  themes[newTheme],
                  monacoRef.current,
                );
                setActiveTheme(newTheme);
                globalThis.localStorage.setItem("monaco-theme", newTheme);
              }}
            >
              {Object.entries(themes).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div>
            {onClickLabel && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={onClick}
              >
                {onClickLabel}
              </button>
            )}
          </div>
        </div>
      </>
    );
  },
);

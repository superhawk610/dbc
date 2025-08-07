import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Editor as MonacoEditor, loader, Monaco } from "@monaco-editor/react";
import { editor as editorNS, Range, Uri } from "monaco-editor";
import { HiX as XIcon } from "react-icons/hi";

export const LAST_QUERY = "lastQuery";

const THEME_LIST_JSON = "https://unpkg.com/monaco-themes/themes/themelist.json";

const DEFAULT_THEMES = {
  "vs-dark": "Default (Dark)",
  "vs-light": "Default (Light)",
};

const DEFAULT_TAB: EditorTab = {
  id: "dbc://_blank",
  name: "Script",
  language: "sql",
  contents: globalThis.localStorage.getItem(LAST_QUERY) ||
    "-- enter query here\n",
};

const EDITOR_OPTIONS: editorNS.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  fontSize: 15,
  minimap: {
    enabled: false,
  },
};

interface MonacoRef {
  editor: editorNS.IStandaloneCodeEditor;
  monaco: Monaco;
  definedThemes: Record<string, boolean>;
  decoration: string | null;
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
  sidebar?: React.ReactNode;
  toolbar?: React.ReactNode;
}

export interface EditorTab {
  id: string;
  name: string;
  language: string;
  contents: string;
}

export interface EditorRef {
  getContents: () => string;
  focus: () => void;
  insert: (text: string) => void;
  openTab: (tab: EditorTab) => void;
}

export default forwardRef(
  function Editor({ onClick, onClickLabel, sidebar, toolbar }: Props, ref) {
    const [tabs, setTabs] = useState<EditorTab[]>([DEFAULT_TAB]);
    const [activeTabIndex, setActiveTabIndex] = useState(0);
    const activeTab = tabs[activeTabIndex];

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
      focus: () => monacoRef.current.editor.focus(),
      insert: (text: string) =>
        monacoRef.current.editor.trigger("keyboard", "type", { text }),
      openTab: (tab: EditorTab) => {
        setTabs([...tabs, tab]);
        setActiveTabIndex(tabs.length);
      },
    }), [tabs]);

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

    function closeTab(id: string, idx: number) {
      // remove the closed tab
      setTabs(tabs.toSpliced(idx, 1));

      // close monaco's underlying model
      monacoRef.current!.monaco.editor.getModel(Uri.parse(id))!.dispose();

      if (idx < activeTabIndex) {
        // if we closed a tab to the left, decrement the active index
        setActiveTabIndex(activeTabIndex - 1);
      } else if (idx === activeTabIndex) {
        // if we closed the active tab, choose the new active tab
        // and set the editor's contents accordingly
        const newIndex = idx === 0 ? 1 : idx - 1;
        setActiveTabIndex(newIndex);
      }
    }

    function formatTabName(tabName: string) {
      const parts = tabName.split(" / ");

      let prefix = null;
      let name = null;
      if (parts.length > 1) {
        prefix = `${parts.slice(0, -1).join(" / ")} /`;
        name = parts[parts.length - 1];
      } else {
        name = parts.join();
      }

      return { prefix, name };
    }

    return (
      <>
        <div className="flex-1 flex flex-row">
          {sidebar}

          <div className="flex-1 border-l-2 border-base-content/10">
            <div className="flex flex-col h-full">
              <div className="flex bg-base-300">
                {tabs.length > 1 && tabs.map((tab, idx) => {
                  const { prefix, name } = formatTabName(tab.name);
                  return (
                    <div
                      role="button"
                      key={idx}
                      className={`
                      flex justify-between px-3 py-1 w-48 text-sm text-left text-ellipsis
                      cursor-pointer border-r border-base-content/10 rounded-t-lg
                    ${
                        idx === activeTabIndex
                          ? "bg-primary text-primary-content hover:bg-primary/90"
                          : "bg-base-100 hover:bg-base-100/70"
                      }`}
                      onClick={() => setActiveTabIndex(idx)}
                    >
                      <span>
                        {prefix && (
                          <span className="opacity-40 pr-1">{prefix}</span>
                        )}
                        {name}
                      </span>
                      <button
                        type="button"
                        className={`cursor-pointer px-1 -mr-1 ${
                          idx === activeTabIndex
                            ? "text-primary-content/60"
                            : "text-base-content/60"
                        }`}
                        onClick={(ev) => {
                          // stop propagation since we're nested inside a tab button
                          // (and we don't want to switch to the tab we're closing)
                          ev.stopPropagation();

                          closeTab(tab.id, idx);
                        }}
                      >
                        <XIcon />
                      </button>
                    </div>
                  );
                })}
              </div>

              {!showEditor ? <div className="h-[30vh]" /> : (
                <MonacoEditor
                  theme={activeTheme}
                  path={activeTab.id}
                  defaultLanguage={activeTab.language}
                  defaultValue={activeTab.contents}
                  options={EDITOR_OPTIONS}
                  onMount={(editor: editorNS.IStandaloneCodeEditor) => {
                    monacoRef.current!.editor = editor;

                    // grab editor focus at 2nd line by default
                    // editor.setPosition({ lineNumber: 2, column: 0 });
                    // editor.focus();

                    // add click action to editor's context menu
                    if (onClickLabel) {
                      editor.addAction({
                        id: "editor-action",
                        label: onClickLabel,
                        keybindings: [
                          monacoRef.current!.monaco.KeyMod.CtrlCmd |
                          monacoRef.current!.monaco.KeyCode.Enter,
                        ],
                        contextMenuGroupId: "2_commands",
                        run: () => {
                          onClick?.();
                        },
                      });
                    }

                    // attach cursor position listener
                    editor.onDidChangeCursorPosition((ev) => {
                      console.log(ev.position);

                      // TODO: figure out which statement we're currently editing
                      // and highlight those lines; probably want to cache that
                      // somewhere, since that's the line(s) we'll dispatch too

                      // const model = editor.getModel()!;
                      // const [decoration] = model.deltaDecorations(
                      //   monacoRef.current.decoration
                      //     ? [monacoRef.current.decoration]
                      //     : [],
                      //   [{
                      //     range: new Range(1, 1, 3, 1),
                      //     options: {
                      //       isWholeLine: true,
                      //       marginClassName: "sql-active-statement-margin",
                      //     },
                      //   }],
                      // );
                      // monacoRef.current.decoration = decoration;
                    });
                  }}
                />
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between py-2 px-4">
          <div className="flex items-center space-x-3">
            <select
              title="Editor Theme"
              className="select select-xs select-ghost w-[200px] focus:outline-primary"
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

            {toolbar}
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

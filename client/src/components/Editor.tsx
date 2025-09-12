import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useImmer } from "use-immer";
import type { Draft } from "immer";
import { format as sqlFormat } from "sql-formatter";
import { Editor as MonacoEditor, loader, Monaco } from "@monaco-editor/react";
import { editor as editorNS, MarkerSeverity, Range, Uri } from "monaco-editor";
import {
  HiDatabase as DatabaseIcon,
  HiDocumentText as TabIcon,
  HiOutlineCube as CubeIcon,
  HiX as XIcon,
} from "react-icons/hi";
import { activeQuery, activeQueryRange } from "./editor/utils.ts";
import DbcCompletionProvider, {
  DbcCompletionProviderContext,
} from "../CompletionProvider.ts";

const OWNER = "dbc";
export const SAVED_TABS = "savedTabs";

const DEFAULT_THEMES = {
  "vs-dark": "Default (Dark)",
  "vs-light": "Default (Light)",
};

// vs code themes converted via https://vsctim.vercel.app
// catppuccin themes from https://github.com/catppuccin/vscode
const CUSTOM_THEMES = {
  "catppuccin-latte": "Catppuccin (Latte)",
  "catppuccin-frappe": "Catppuccin (Frappe)",
  "catppuccin-macchiato": "Catppuccin (Macchiato)",
  "catppuccin-mocha": "Catppuccin (Mocha)",
};

const DEFAULT_TAB: EditorTab = {
  id: "dbc://query/1",
  name: "Query / Script 1",
  language: "sql",
  contents: "-- enter query here\n",
};

const EDITOR_OPTIONS: editorNS.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  fontSize: 15,
  minimap: {
    enabled: false,
  },
  lineNumbersMinChars: 4,
  lineDecorationsWidth: 0,
};

interface MonacoRef {
  initialized: boolean;
  editor: editorNS.IStandaloneCodeEditor;
  monaco: Monaco;
  definedThemes: Record<string, boolean>;
  decorations: string[];
  callbacks: Record<string, () => void>;
}

async function fetchTheme(theme: string, ref: MonacoRef) {
  // if we've already loaded the theme, don't do anything
  if (ref.definedThemes[theme]) return;

  // default themes are always included
  if (theme in DEFAULT_THEMES) return;

  if (theme in CUSTOM_THEMES) {
    const themeRes = await fetch(`/editor/themes/custom/${theme}.json`);
    const themeJson = await themeRes.json();

    patchTheme(themeJson);
    ref.monaco.editor.defineTheme(theme, themeJson);
    ref.definedThemes[theme] = true;
    return;
  }

  const res = await fetch(`/editor/themes/monaco-themes/${theme}.json`);
  const themeJson = await res.json();

  patchTheme(themeJson);
  ref.monaco.editor.defineTheme(theme, themeJson);
  ref.definedThemes[theme] = true;
}

// patch `string.sql` tokens, since they seem to always be red
function patchTheme(theme: editorNS.IStandaloneThemeData) {
  const stringRule = theme.rules.find((rule) => rule.token === "string");
  if (stringRule) {
    theme.rules.push({ ...stringRule, token: "string.sql" });
  }
}

export interface Props {
  onClick?: () => void;
  onClickLabel?: string;
  hideSidebar?: boolean;
  sidebar?: React.ReactNode;
  toolbar?: React.ReactNode;
  connection: string | null | undefined;
  database: string | null;
  schema: string | null;
}

export interface EditorTab {
  id: string;
  name: string | ((index: number) => string);
  language: string;
  contents: string;
  icon?: string;
}

export interface EditorRef {
  getContents: () => string;
  getActiveQuery: () => { query: string; offset: number } | null;
  focus: () => void;
  insert: (text: string) => void;
  openTab: (tab: EditorTab) => void;
  addError: (message: string, position: number, fromOffset?: number) => void;
  clearErrors: () => void;
  saveTabs: () => void;
}

interface TabState {
  tabs: EditorTab[];
  activeIndex: number;
}

export default forwardRef(
  function Editor(
    {
      onClick,
      onClickLabel,
      hideSidebar,
      sidebar,
      toolbar,
      connection,
      database,
      schema,
    }: Props,
    ref,
  ) {
    const tabIndexRef = useRef(0);
    const [tabState, setTabState] = useImmer<TabState>(() => {
      // attempt to restore previously-saved tabs, falling back to default
      // if this is the first launch
      const json = globalThis.localStorage.getItem(SAVED_TABS);
      const tabs = json ? JSON.parse(json) : [DEFAULT_TAB];
      tabIndexRef.current = tabs.length;
      return { tabs, activeIndex: 0 };
    });

    const activeTab = tabState.tabs[tabState.activeIndex];

    const [showEditor, setShowEditor] = useState(false);
    const monacoRef = useRef({ definedThemes: {}, callbacks: {} } as MonacoRef);
    const [themes, setThemes] = useState<Record<string, string | null>>(
      DEFAULT_THEMES,
    );
    const [activeTheme, setActiveTheme] = useState(
      globalThis.localStorage.getItem("monaco-theme") ?? "vs-dark",
    );

    const providerContextRef = useRef<DbcCompletionProviderContext>({
      connection,
      database,
      schema,
    });

    // keep editor context in sync
    useEffect(() => {
      monacoRef.current.callbacks.onClick = onClick!;
    }, [onClick]);

    // keep provider context in sync with editor
    useEffect(() => {
      providerContextRef.current.connection = connection;
      providerContextRef.current.database = database;
      providerContextRef.current.schema = schema;
    }, [connection, database, schema]);

    useImperativeHandle(ref, () => ({
      getContents: () => monacoRef.current.editor.getValue(),
      getActiveQuery: () =>
        activeQuery(
          monacoRef.current!.editor.getModel()!,
          monacoRef.current!.editor.getPosition()!,
        ),
      focus: () => monacoRef.current.editor.focus(),
      insert: (text: string) =>
        monacoRef.current.editor.trigger("keyboard", "type", { text }),
      openTab: (tab: EditorTab) => {
        setTabState((draft: Draft<TabState>) => {
          // store the current tab's contents before switching tabs
          draft.tabs[draft.activeIndex].contents = monacoRef.current.editor
            .getValue();

          // check to see if we already have the tab open; if so, just switch to it
          const tabIndex = draft.tabs.findIndex((t) => t.id === tab.id);
          if (tabIndex > -1) {
            draft.activeIndex = tabIndex;
          } else {
            // resolve tab name first
            if (typeof tab.name === "function") {
              tab.name = tab.name(tabIndexRef.current);
            }

            // increment tab index whether or not it was used
            tabIndexRef.current += 1;

            // if not, create it first and then switch to it
            draft.tabs = [...draft.tabs, tab];
            draft.activeIndex = draft.tabs.length - 1;
          }

          globalThis.localStorage.setItem(
            SAVED_TABS,
            JSON.stringify(draft.tabs),
          );
        });
      },
      addError: (message: string, position: number, fromOffset?: number) => {
        const model = monacoRef.current.editor.getModel()!;
        const pos = model.getPositionAt((fromOffset ?? 0) + position);
        const range = new Range(
          pos.lineNumber,
          pos.column - 1,
          pos.lineNumber,
          pos.column,
        );

        monacoRef.current.monaco.editor.setModelMarkers(
          monacoRef.current.editor.getModel()!,
          OWNER,
          [{ message, severity: MarkerSeverity.Error, ...range }],
        );
      },
      clearErrors: () =>
        monacoRef.current.monaco.editor.removeAllMarkers(OWNER),
      saveTabs: () => {
        setTabState((draft: Draft<TabState>) => {
          // store the current tab's contents before saving
          const tabId = draft.tabs[draft.activeIndex].id;
          const tabContents = monacoRef.current!.monaco.editor.getModel(
            Uri.parse(tabId),
          )?.getValue();

          // it's possible the model hasn't been created if this is a tab we
          // just opened; if that's the case, no need to do anything else
          if (tabContents) {
            draft.tabs[draft.activeIndex].contents = tabContents;
          }

          // persist the current tabs either way
          globalThis.localStorage.setItem(
            SAVED_TABS,
            JSON.stringify(draft.tabs),
          );
        });
      },
    }), []);

    useEffect(() => {
      (async () => {
        // prevent duplicate initialization
        if (monacoRef.current.initialized) return;
        monacoRef.current.initialized = true;

        monacoRef.current.monaco = await loader.init();

        const res = await fetch(`/editor/themes/monaco-themes.json`);
        const data = await res.json();

        const themes: Record<string, string | null> = {
          ...DEFAULT_THEMES,
          "-- custom --": null,
          ...CUSTOM_THEMES,
          "-- monaco-themes --": null,
          ...data,
        };
        setThemes(themes);

        // fetch the active theme, in case it's not already cached
        await fetchTheme(activeTheme, monacoRef.current);

        // register completion provider
        monacoRef.current.monaco.languages.registerCompletionItemProvider(
          "sql",
          new DbcCompletionProvider(providerContextRef.current),
        );

        setShowEditor(true);
      })();
    }, []);

    function onEditorMount(editor: editorNS.IStandaloneCodeEditor) {
      monacoRef.current!.editor = editor;

      // grab editor focus at 2nd line by default
      // editor.setPosition({ lineNumber: 2, column: 0 });
      // editor.focus();

      editor.addAction({
        id: "format-document-action",
        label: "Format Document",
        keybindings: [
          monacoRef.current!.monaco.KeyMod.CtrlCmd |
          monacoRef.current!.monaco.KeyCode.KeyF,
        ],
        contextMenuGroupId: "2_commands",
        run: () => {
          const model = editor.getModel()!;
          const text = model.getValue();
          const formatted = sqlFormat(text, { language: "postgresql" });
          editor.executeEdits("format-document-action", [{
            range: model.getFullModelRange(),
            text: formatted,
          }]);
          editor.pushUndoStop();
        },
      });

      editor.addAction({
        id: "format-query-action",
        label: "Format Query",
        keybindings: [
          monacoRef.current!.monaco.KeyMod.CtrlCmd |
          monacoRef.current!.monaco.KeyMod.Shift |
          monacoRef.current!.monaco.KeyCode.KeyF,
        ],
        contextMenuGroupId: "2_commands",
        run: () => {
          const model = editor.getModel()!;
          const text = model.getValue();
          let range = activeQueryRange(text, editor.getPosition()!);
          if (!range) return;

          // extend to end of last line
          range = range.setEndPosition(
            range.endLineNumber,
            model.getLineMaxColumn(range.endLineNumber),
          );

          const query = model.getValueInRange(range);
          const formatted = sqlFormat(query, { language: "postgresql" });
          editor.executeEdits("format-query-action", [{
            range,
            text: formatted,
          }]);
          editor.pushUndoStop();
        },
      });

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
          run: () => monacoRef.current.callbacks.onClick?.(),
        });
      }

      // attach cursor position listener
      editor.onDidChangeCursorPosition(({ position }) => {
        const model = editor.getModel()!;
        const range = activeQueryRange(editor.getValue(), position);

        monacoRef.current.decorations = model.deltaDecorations(
          monacoRef.current.decorations,
          !range ? [] : [{
            range,
            options: {
              isWholeLine: true,
              marginClassName: "sql-active-statement-margin",
            },
          }],
        );
      });
    }

    function closeTab(id: string, idx: number) {
      setTabState((draft: Draft<TabState>) => {
        // remove the closed tab
        draft.tabs.splice(idx, 1);

        // update saved tabs
        globalThis.localStorage.setItem(SAVED_TABS, JSON.stringify(draft.tabs));

        // close monaco's underlying model (it may not have been opened yet
        // if the tab was restored from a previous session)
        monacoRef.current!.monaco.editor.getModel(Uri.parse(id))?.dispose();

        if (idx < draft.activeIndex) {
          // if we closed a tab to the left, decrement the active index
          draft.activeIndex -= 1;
        } else if (draft.activeIndex === draft.tabs.length) {
          // if we closed the rightmost tab, shift one to the left
          draft.activeIndex -= 1;
        }
      });
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
          {!hideSidebar && sidebar}

          <div className="flex-1 border-l-2 border-base-content/10">
            <div className="flex flex-col h-full">
              <div className="flex bg-base-300">
                {tabState.tabs.length > 1 && tabState.tabs.map((tab, idx) => {
                  const { prefix, name } = formatTabName(tab.name as string);
                  return (
                    <div
                      role="button"
                      key={idx}
                      className={`
                      flex items-center px-3 py-1 text-xs cursor-pointer
                      border-r border-base-content/10
                    ${
                        idx === tabState.activeIndex
                          ? "bg-primary text-primary-content hover:bg-primary/90"
                          : "bg-base-100 hover:bg-base-100/70"
                      }`}
                      onClick={() => {
                        setTabState((draft: Draft<TabState>) => {
                          // store the current tab's contents before switching tabs
                          draft.tabs[draft.activeIndex].contents = monacoRef
                            .current.editor
                            .getValue();

                          draft.activeIndex = idx;
                        });
                      }}
                    >
                      <div className="mr-1">
                        {tab.icon === "database"
                          ? <DatabaseIcon />
                          : tab.icon === "cube"
                          ? <CubeIcon />
                          : <TabIcon />}
                      </div>
                      <span className="min-w-32 max-w-56 mr-2 py-1 overflow-hidden whitespace-nowrap text-ellipsis">
                        {prefix && (
                          <span className="opacity-40 pr-1">{prefix}</span>
                        )}
                        {name}
                      </span>
                      <button
                        type="button"
                        className={`btn btn-xs btn-ghost rounded-sm hover:bg-black/30 hover:border-transparent
                          hover:shadow-none cursor-pointer px-1 ml-auto -mr-1.5 ${
                          idx === tabState.activeIndex
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
                  onMount={onEditorMount}
                />
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between py-2 px-4">
          <div className="flex-1 flex items-center space-x-3">
            <select
              title="Editor Theme"
              className="select select-xs select-ghost shrink basis-[200px] focus:outline-primary"
              value={activeTheme}
              onChange={async (e) => {
                const newTheme = e.target.value;
                await fetchTheme(newTheme, monacoRef.current);
                setActiveTheme(newTheme);
                globalThis.localStorage.setItem("monaco-theme", newTheme);
              }}
            >
              {Object.entries(themes).map(([key, value]) =>
                value
                  ? (
                    <option key={key} value={key}>
                      {value}
                    </option>
                  )
                  : (
                    <option key={key} value={key} disabled>
                      --
                    </option>
                  )
              )}
            </select>

            {toolbar}
          </div>

          <div className="ml-24">
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

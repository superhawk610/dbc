import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Editor as MonacoEditor, loader, Monaco } from "@monaco-editor/react";
import {
  editor as editorNS,
  MarkerSeverity,
  Position,
  Range,
  Uri,
} from "monaco-editor";
import {
  HiDatabase as DatabaseIcon,
  HiDocumentText as TabIcon,
  HiX as XIcon,
} from "react-icons/hi";
import DbcCompletionProvider, {
  DbcCompletionProviderContext,
} from "../CompletionProvider.ts";

import themeCatppuccinLatte from "../themes/catppuccin-latte.json" with {
  type: "json",
};
import themeCatppuccinFrappe from "../themes/catppuccin-frappe.json" with {
  type: "json",
};
import themeCatppuccinMacchiato from "../themes/catppuccin-macchiato.json" with {
  type: "json",
};
import themeCatppuccinMocha from "../themes/catppuccin-mocha.json" with {
  type: "json",
};

const OWNER = "dbc";
export const SAVED_TABS = "savedTabs";

// FIXME: cache this during build or something
// unkpg seems to throttle when it sees too many requests or something, because
// bundled builds take ~13 seconds to load and it's just blocked on this call
// const THEME_LIST_JSON = "https://unpkg.com/monaco-themes/themes/themelist.json";
import themeListJson from "../themes/monaco-themes/themelist.json" with {
  type: "json",
};
const THEME_LIST_JSON = themeListJson;

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

const CUSTOM_THEMES_JSON: Record<string, editorNS.IStandaloneThemeData> = {
  "catppuccin-latte": themeCatppuccinLatte as editorNS.IStandaloneThemeData,
  "catppuccin-frappe": themeCatppuccinFrappe as editorNS.IStandaloneThemeData,
  "catppuccin-macchiato":
    themeCatppuccinMacchiato as editorNS.IStandaloneThemeData,
  "catppuccin-mocha": themeCatppuccinMocha as editorNS.IStandaloneThemeData,
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
}

// TODO: look into using https://github.com/DTStack/monaco-sql-languages
// for improved syntax highlighting and semantic parsing
async function fetchTheme(theme: string, filename: string, ref: MonacoRef) {
  // if we've already loaded the theme, don't do anything
  if (ref.definedThemes[theme]) return;

  // default themes are always included
  if (theme in DEFAULT_THEMES) return;

  if (theme in CUSTOM_THEMES) {
    const themeJson = CUSTOM_THEMES_JSON[theme];

    patchTheme(themeJson);
    ref.monaco.editor.defineTheme(theme, themeJson);
    ref.definedThemes[theme] = true;
    return;
  }

  const url = `https://unpkg.com/monaco-themes/themes/${filename}.json`;
  const res = await fetch(url);
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

function excludeComments(line: string) {
  const blockCommentStartIdx = line.indexOf("/*");
  if (blockCommentStartIdx > -1) line = line.slice(0, blockCommentStartIdx);

  const lineCommentStartIdx = line.indexOf("--");
  if (lineCommentStartIdx > -1) line = line.slice(0, blockCommentStartIdx);

  return line;
}

function activeQueryRange(
  editor: editorNS.IStandaloneCodeEditor,
  position: Position,
): Range | null {
  const text = editor.getValue();
  const lines = text.split("\n");

  const cursorLineIdx = position.lineNumber - 1;
  let startLineIdx = cursorLineIdx;
  let endLineIdx = cursorLineIdx;
  const excludedLines = new Set();

  // first, scan for comments and exclude any blank lines,
  // lines entirely contained within a block comment, and
  // lines that only contain a line comment
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // skip line comments and empty lines
    if (line === "" || line.startsWith("--")) {
      excludedLines.add(i);
      continue;
    }

    // exclude block comment start/end lines
    if (line.startsWith("/*") || line.startsWith("*/")) {
      excludedLines.add(i);
    }

    if (inComment && lines[i].includes("*/")) inComment = false;
    if (inComment) excludedLines.add(i);
    if (lines[i].includes("/*")) inComment = true;
  }

  // if we're on an excluded line, don't highlight anything
  if (excludedLines.has(cursorLineIdx)) {
    return null;
  }

  // move backwards to find start line
  let prevLineIdx = cursorLineIdx;
  for (let i = cursorLineIdx; i >= 0; i--) {
    if (excludedLines.has(i)) continue;

    if (i !== cursorLineIdx && excludeComments(lines[i]).includes(";")) {
      startLineIdx = prevLineIdx;
      break;
    }

    startLineIdx = i;
    prevLineIdx = i;
  }

  // move forwards to find end line
  for (let i = cursorLineIdx; i < lines.length; i++) {
    if (excludedLines.has(i)) continue;

    if (excludeComments(lines[i]).includes(";")) {
      endLineIdx = i;
      break;
    }
  }

  return new Range(startLineIdx! + 1, 1, endLineIdx! + 1, 1);
}

function textInLineRange(
  editor: editorNS.IStandaloneCodeEditor,
  range: Range,
): string {
  const text = editor.getValue();
  const lines = text.split("\n");
  return lines.slice(range.startLineNumber - 1, range.endLineNumber).join("\n");
}

function activeQuery(editor: editorNS.IStandaloneCodeEditor): string | null {
  const position = editor.getPosition();
  const range = position ? activeQueryRange(editor, position) : null;
  return range ? textInLineRange(editor, range) : null;
}

export interface Props {
  onClick?: () => void;
  onClickLabel?: string;
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
  getActiveQuery: () => string;
  focus: () => void;
  insert: (text: string) => void;
  openTab: (tab: EditorTab) => void;
  addError: (message: string, position: number) => void;
  clearErrors: () => void;
  saveTabs: () => void;
}

export default forwardRef(
  function Editor(
    { onClick, onClickLabel, sidebar, toolbar, connection, database, schema }:
      Props,
    ref,
  ) {
    const tabIndexRef = useRef(0);
    const [tabs, setTabs] = useState<EditorTab[]>(() => {
      // attempt to restore previously-saved tabs, falling back to default
      // if this is the first launch
      const json = globalThis.localStorage.getItem(SAVED_TABS);
      const tabs = json ? JSON.parse(json) : [DEFAULT_TAB];
      tabIndexRef.current = tabs.length;
      return tabs;
    });

    const [activeTabIndex, setActiveTabIndex] = useState(0);
    const activeTab = tabs[activeTabIndex];

    const [showEditor, setShowEditor] = useState(false);
    const monacoRef = useRef({ definedThemes: {} } as MonacoRef);
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

    // keep provider context in sync with editor
    useEffect(() => {
      providerContextRef.current.connection = connection;
      providerContextRef.current.database = database;
      providerContextRef.current.schema = schema;
    }, [connection, database, schema]);

    useImperativeHandle(ref, () => ({
      getContents: () => monacoRef.current.editor.getValue(),
      getActiveQuery: () => activeQuery(monacoRef.current.editor),
      focus: () => monacoRef.current.editor.focus(),
      insert: (text: string) =>
        monacoRef.current.editor.trigger("keyboard", "type", { text }),
      openTab: (tab: EditorTab) => {
        // store the current tab's contents before switching tabs
        tabs[activeTabIndex].contents = monacoRef.current.editor.getValue();
        let newTabs = tabs;

        // check to see if we already have the tab open; if so, just switch to it
        const tabIndex = tabs.findIndex((t) => t.id === tab.id);
        if (tabIndex > -1) {
          setActiveTabIndex(tabIndex);
        } else {
          // resolve tab name first
          if (typeof tab.name === "function") {
            tab.name = tab.name(tabIndexRef.current);
          }

          // increment tab index whether or not it was used
          tabIndexRef.current += 1;

          // if not, create it first and then switch to it
          newTabs = [...tabs, tab];
          setActiveTabIndex(tabs.length);
        }

        setTabs(newTabs);
        globalThis.localStorage.setItem(SAVED_TABS, JSON.stringify(newTabs));
      },
      addError: (message: string, position: number) => {
        const model = monacoRef.current.editor.getModel()!;
        const pos = model.getPositionAt(position);
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
        // store the current tab's contents before saving
        tabs[activeTabIndex].contents = monacoRef.current.editor.getValue();
        setTabs(tabs);

        globalThis.localStorage.setItem(SAVED_TABS, JSON.stringify(tabs));
      },
    }), [tabs]);

    useEffect(() => {
      (async () => {
        // prevent duplicate initialization
        if (monacoRef.current.initialized) return;
        monacoRef.current.initialized = true;

        monacoRef.current.monaco = await loader.init();

        // const res = await fetch(THEME_LIST_JSON);
        // const data = await res.json();
        const data = THEME_LIST_JSON;

        const themes: Record<string, string | null> = {
          ...DEFAULT_THEMES,
          "-- custom --": null,
          ...CUSTOM_THEMES,
          "-- monaco-themes --": null,
          ...data,
        };
        setThemes(themes);

        // fetch the active theme, in case it's not already cached
        await fetchTheme(activeTheme, themes[activeTheme]!, monacoRef.current);

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
          // TODO: this callback changes with hot reloads
          run: () => onClick?.(),
        });
      }

      // attach cursor position listener
      editor.onDidChangeCursorPosition(({ position }) => {
        const model = editor.getModel()!;
        const range = activeQueryRange(editor, position);

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
      // remove the closed tab
      const newTabs = tabs.toSpliced(idx, 1);
      setTabs(newTabs);

      // update saved tabs
      globalThis.localStorage.setItem(SAVED_TABS, JSON.stringify(newTabs));

      // close monaco's underlying model (it may not have been opened yet
      // if the tab was restored from a previous session)
      monacoRef.current!.monaco.editor.getModel(Uri.parse(id))?.dispose();

      if (idx < activeTabIndex) {
        // if we closed a tab to the left, decrement the active index
        setActiveTabIndex(activeTabIndex - 1);
      } else if (idx === tabs.length - 1) {
        // if we closed the rightmost tab, shift one to the left
        setActiveTabIndex(idx - 1);
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
                  const { prefix, name } = formatTabName(tab.name as string);
                  return (
                    <div
                      role="button"
                      key={idx}
                      className={`
                      flex items-center px-3 py-1.5 text-xs cursor-pointer
                      border-r border-base-content/10
                    ${
                        idx === activeTabIndex
                          ? "bg-primary text-primary-content hover:bg-primary/90"
                          : "bg-base-100 hover:bg-base-100/70"
                      }`}
                      onClick={() => {
                        // store the current tab's contents before switching tabs
                        tabs[activeTabIndex].contents = monacoRef.current.editor
                          .getValue();

                        setTabs(tabs);
                        setActiveTabIndex(idx);
                      }}
                    >
                      <div className="mr-1">
                        {tab.icon === "database"
                          ? <DatabaseIcon />
                          : <TabIcon />}
                      </div>
                      <span className="min-w-32 max-w-56 mr-2 overflow-hidden whitespace-nowrap text-ellipsis">
                        {prefix && (
                          <span className="opacity-40 pr-1">{prefix}</span>
                        )}
                        {name}
                      </span>
                      <button
                        type="button"
                        className={`cursor-pointer px-1 ml-auto -mr-1 ${
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
                await fetchTheme(
                  newTheme,
                  themes[newTheme]!,
                  monacoRef.current,
                );
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

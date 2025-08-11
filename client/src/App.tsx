import { useEffect, useRef, useState } from "react";
import {
  HiDatabase as SchemaTabIcon,
  HiDocumentAdd as NewTabIcon,
  HiViewList as ListIcon,
} from "react-icons/hi";
import { get, post } from "./api.ts";

import useResize from "./hooks/useResize.tsx";
import Navbar from "./components/Navbar.tsx";
import Editor, { EditorRef, LAST_QUERY } from "./components/Editor.tsx";
import ConnectionSelect from "./components/editor/ConnectionSelect.tsx";
import DatabaseSelect from "./components/editor/DatabaseSelect.tsx";
import SchemaSelect from "./components/editor/SchemaSelect.tsx";
import QueryResults from "./components/QueryResults.tsx";
import Pagination from "./components/Pagination.tsx";
import Connection from "./models/connection.ts";
import { PaginatedQueryResult } from "./models/query.ts";
import Database from "./models/database.ts";
import Schema from "./models/schema.ts";
import Table from "./models/table.ts";
import SettingsModal from "./components/SettingsModal.tsx";

const EDITOR_HEIGHT = { min: 100, default: 400 };

// FIXME: do new tab creation IDs better
let n = 1;

interface LastQuery {
  query: string;
  page: number;
  pageSize: number;
}

function App() {
  const editorRef = useRef<EditorRef>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const [showResults, setShowResults] = useState(false);
  const [settingsModalActive, setSettingsModalsActive] = useState(false);

  const [res, setRes] = useState<PaginatedQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // FIXME: read from server
  const [connections, setConnections] = useState([
    { name: "default" } as Connection,
  ]);
  const [connection, setConnection] = useState("default");

  const [databases, setDatabases] = useState<Database[] | null>(null);
  const [database, setDatabase] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<Schema[] | null>(null);
  const [schema, setSchema] = useState<string | null>(null);
  const [tables, setTables] = useState<Table[] | null>(null);

  // TODO: prefetch more than the current page
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [query, setQuery] = useState<string | null>(null);
  const queryRef = useRef({} as LastQuery);

  // TODO: switch between multiple connections
  useEffect(() => {
    (async () => {
      const [databases, schemas] = await Promise.all([
        get<Database[]>("/db/databases"),
        get<Schema[]>("/db/schemas"),
      ]);

      setDatabases(databases);
      setSchemas(schemas);

      // select first available database by default
      if (databases.length > 0) setDatabase(databases[0].datname);

      // select first available schema by default
      if (schemas.length > 0) setSchema(schemas[0].schema_name);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const tables = await get<Table[]>(`/db/schemas/${schema}/tables`);
      setTables(tables);
    })();
  }, [schema]);

  useResize({
    active: showResults,
    resizeRef,
    resizeHandleRef,
    minHeight: EDITOR_HEIGHT.min,
    defaultHeight: EDITOR_HEIGHT.default,
  });

  async function dispatchQuery(query: string, page: number, pageSize: number) {
    // show results pane
    setShowResults(true);

    try {
      const res = await post("/query", { query, page, page_size: pageSize });
      setError(null);
      setRes(res);

      // if the statement contained DDL, refresh the table view
      if (res.is_ddl) {
        const tables = await get("/db/tables");
        setTables(tables);
      }
    } catch (err) {
      console.log("caught");
      setError((err as Error).message);
      setRes(null);
    }
  }

  useEffect(() => {
    // if there's no query, do nothing
    if (!query) return;

    // if nothing has changed, do nothing
    if (
      queryRef.current.query === query &&
      queryRef.current.page === page &&
      queryRef.current.pageSize === pageSize
    ) {
      return;
    }

    queryRef.current = { query, page, pageSize };
    dispatchQuery(query, page, pageSize);
  }, [query, page, pageSize]);

  return (
    <div className="flex flex-col items-stretch w-screen h-screen">
      <Navbar onSaveSettings={setConnections}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            n += 1;
            editorRef.current!.openTab({
              id: `dbc://query/${n}`,
              name: `Query / Script ${n}`,
              language: "sql",
              contents: "",
            });
          }}
        >
          <NewTabIcon /> New Tab
        </button>
        <button
          type="button"
          className={`btn btn-sm ${showResults && "btn-primary"}`}
          onClick={() => setShowResults(!showResults)}
        >
          <ListIcon /> Results
        </button>
      </Navbar>

      <div
        ref={resizeRef}
        className={`flex flex-col ${showResults ? "" : "flex-grow-1"}`}
      >
        <Editor
          ref={editorRef}
          onClick={() => {
            const contents = editorRef.current!.getContents();

            // store the query in local storage to be restored on page reload
            globalThis.localStorage.setItem(LAST_QUERY, contents);

            setQuery(editorRef.current!.getActiveQuery() || contents);
          }}
          onClickLabel="Query ⌘⏎"
          sidebar={
            <div className="w-[300px] overflow-auto">
              <h1 className="mb-0 px-4 divider divider-start text-xs text-base-content/80 uppercase">
                tables
              </h1>
              <ul className="menu w-full">
                {!tables
                  ? (
                    <li>
                      <span className="loading loading-infinity loading-xl" />
                    </li>
                  )
                  : tables.map((row) => (
                    <li key={row["table_name"] as string}>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await get(
                            `/db/ddl/table/${row["table_name"]}`,
                          );

                          // insert text into editor
                          // editorRef.current!.insert(row[2]);
                          // editorRef.current!.focus();

                          // open new editor tab
                          editorRef.current!.openTab({
                            id: `dbc://table/${row["table_name"]}`,
                            name: `Table / ${row["table_name"]}`,
                            language: "sql",
                            contents: res.ddl,
                            icon: <SchemaTabIcon />,
                          });
                        }}
                      >
                        {row["table_name"]}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          }
          toolbar={
            <>
              {connections && (
                <ConnectionSelect
                  connections={connections}
                  selected={connection}
                  onSelect={setConnection}
                  onManageConnections={() => setSettingsModalsActive(true)}
                />
              )}
              {databases && (
                <DatabaseSelect
                  databases={databases}
                  selected={database}
                  onSelect={setDatabase}
                />
              )}
              {schemas && (
                <SchemaSelect
                  schemas={schemas}
                  selected={schema}
                  onSelect={setSchema}
                />
              )}
            </>
          }
        />
      </div>

      <SettingsModal
        active={settingsModalActive}
        onClose={() => setSettingsModalsActive(false)}
        onSave={setConnections}
      />

      {showResults && (
        <div className="flex-1 flex flex-col bg-base-300 overflow-y-auto">
          <div
            ref={resizeHandleRef}
            className="bg-base-content/10 h-1 cursor-ns-resize z-[10]"
          />

          <QueryResults page={res} error={error} />
          {res && (
            <Pagination
              query={res}
              page={page}
              setPage={setPage}
              pageSize={pageSize}
              setPageSize={setPageSize}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default App;

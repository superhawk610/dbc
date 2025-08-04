import { useEffect, useRef, useState } from "react";
import { HiViewList as ListIcon } from "react-icons/hi";
import { get, post } from "./api.ts";

import useResize from "./hooks/useResize.tsx";
import Navbar from "./components/Navbar.tsx";
import Editor, { EditorRef, LAST_QUERY } from "./components/Editor.tsx";
import QueryRow, { QueryResult, QueryValue } from "./models/query.ts";

const EDITOR_HEIGHT = 400;

function App() {
  const editorRef = useRef<EditorRef>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const [showResults, setShowResults] = useState(false);

  const [res, setRes] = useState<QueryResult | null>(null);
  const [tables, setTables] = useState<QueryRow[] | null>(null);
  const [databases, setDatabases] = useState<QueryRow[] | null>(null);
  const [schemas, setSchemas] = useState<QueryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // TODO: switch between multiple connections
  useEffect(() => {
    (async () => {
      const [databases, schemas, tables] = await Promise.all([
        get("/db/databases"),
        get("/db/schemas"),
        get("/db/tables"),
      ]);

      setDatabases(databases);
      setSchemas(schemas);
      setTables(tables);
    })();
  }, []);

  useResize({
    resizeRef,
    resizeHandleRef,
    minHeight: EDITOR_HEIGHT,
    defaultHeight: showResults ? EDITOR_HEIGHT : null,
  });

  async function dispatchQuery() {
    const query = editorRef.current!.getContents();

    // store the query in local storage to be restored on page reload
    globalThis.localStorage.setItem(LAST_QUERY, query);

    // show results pane
    setShowResults(true);

    try {
      const res = await post("/query", { query });
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

  return (
    <div className="flex flex-col items-stretch w-screen h-screen">
      <Navbar>
        <button
          type="button"
          className={`btn btn-sm ${showResults && "btn-primary"}`}
          onClick={() => setShowResults(!showResults)}
        >
          <ListIcon /> Results
        </button>
      </Navbar>

      <div ref={resizeRef} className="flex flex-col h-full">
        <Editor
          ref={editorRef}
          onClick={dispatchQuery}
          onClickLabel="Query ⌘⏎"
          sidebar={
            <div className="w-[300px] overflow-auto">
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
              <select
                title="Connection"
                className="select select-xs select-ghost m-2 w-[200px]"
              >
                <option value="default">
                  default
                </option>
              </select>

              <select
                title="Database"
                disabled={!databases}
                className="select select-xs select-ghost m-2 w-[200px]"
              >
                {databases?.map((row) => (
                  <option
                    key={row["datname"] as string}
                    value={row["datname"] as string}
                  >
                    {row["datname"]}
                  </option>
                ))}
              </select>

              <select
                title="Schema"
                disabled={!schemas}
                className="select select-xs select-ghost m-2 w-[200px]"
              >
                {schemas?.map((row) => (
                  <option
                    key={row["schema_name"] as string}
                    value={row["schema_name"] as string}
                  >
                    {row["schema_name"]}
                  </option>
                ))}
              </select>
            </>
          }
        />
      </div>

      {showResults && (
        <div className="flex-1 bg-base-300">
          <div
            ref={resizeHandleRef}
            className="bg-base-content/10 pt-1 cursor-ns-resize z-[10]"
          />

          <div className="overflow-auto">
            {!res && <p className="mt-4 px-6 text-sm">No results.</p>}

            <table className="table table-zebra table-pin-rows table-compact">
              {res && (
                <thead>
                  <tr>
                    {res.columns.map((column) => (
                      <th key={column.name} className="font-semibold">
                        {column.name}
                        <span className="pl-2 font-normal text-xs text-base-content-300/60">
                          {column.type}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {error
                  ? (
                    <tr>
                      <td className="font-mono text-red-400">
                        {error}
                      </td>
                    </tr>
                  )
                  : !res
                  ? null
                  : res.rows.length === 0
                  ? (
                    <tr>
                      <td colSpan={res.columns.length}>
                        No results.
                      </td>
                    </tr>
                  )
                  : res.rows.map((row, idx) => (
                    <tr key={idx}>
                      {row.map((value: QueryValue, idx: number) => (
                        <td key={idx}>
                          {value === true
                            ? "true"
                            : value === false
                            ? "false"
                            : value === null
                            ? (
                              <span className="text-gray-500">
                                &lt;null&gt;
                              </span>
                            )
                            : Array.isArray(value)
                            ? JSON.stringify(value)
                            : value}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {res && (
            <div className="p-4 text-sm text-base-content-300/60">
              {res.rows.length} rows
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;

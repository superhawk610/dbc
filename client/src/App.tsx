import { useEffect, useRef, useState } from "react";
import { get, post } from "./api.ts";

import useResize from "./hooks/useResize.tsx";
import Navbar from "./components/Navbar.tsx";
import Editor, { EditorRef, LAST_QUERY } from "./components/Editor.tsx";

function App() {
  const editorRef = useRef<EditorRef>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const [res, setRes] = useState<any | null>(null);
  const [tables, setTables] = useState<any | null>(null);
  const [databases, setDatabases] = useState<any | null>(null);
  const [schemas, setSchemas] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  // TODO: more ergonomic API for reading rows from server
  // TODO: switch between multiple connections
  useEffect(() => {
    (async () => {
      const databases = await get("/db/databases");
      const schemas = await get("/db/schemas");
      const tables = await get("/db/tables");

      setDatabases(databases);
      setSchemas(schemas);
      setTables(tables);

      // set the result view to list available databases on initial load
      setRes(databases);
    })();
  }, []);

  useResize({
    resizeRef,
    resizeHandleRef,
    minHeight: 300,
  });

  async function dispatchQuery() {
    const query = editorRef.current!.getContents();

    // store the query in local storage to be restored on page reload
    globalThis.localStorage.setItem(LAST_QUERY, query);

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
      setError((err as any).message);
      setRes(null);
    }
  }

  return (
    <div className="flex flex-col items-stretch w-screen h-screen">
      <Navbar />
      <div ref={resizeRef} className="flex flex-col">
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
                  : tables.rows.map((row: string[]) => (
                    <li key={row[2]}>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await get(`/db/ddl/table/${row[2]}`);

                          // insert text into editor
                          // editorRef.current!.insert(row[2]);
                          // editorRef.current!.focus();

                          // open new editor tab
                          editorRef.current!.openTab(
                            `Table / ${row[2]}`,
                            res.ddl,
                          );
                        }}
                      >
                        {row[2]}
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
                {databases?.rows.map((row: string[]) => (
                  <option key={row[1]} value={row[1]}>
                    {row[1]}
                  </option>
                ))}
              </select>

              <select
                title="Schema"
                disabled={!schemas}
                className="select select-xs select-ghost m-2 w-[200px]"
              >
                {schemas?.rows.map((row: string[]) => (
                  <option key={row[1]} value={row[1]}>
                    {row[1]}
                  </option>
                ))}
              </select>
            </>
          }
        />
      </div>

      <div
        ref={resizeHandleRef}
        className="bg-base-content/10 pt-1 my-1 cursor-ns-resize z-[10]"
      />

      <div className="mx-4 overflow-auto">
        <table className="table table-zebra table-pin-rows table-compact">
          {res && (
            <thead>
              <tr>
                {res.columns.map((column: any) => (
                  <th key={column.name}>
                    {column.name}
                    <span className="pl-2 font-normal text-xs text-gray-500">
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
              : res.rows.map((row: any, idx: number) => (
                <tr key={idx}>
                  {row.map((value: any, idx: number) => (
                    <td key={idx}>
                      {value === true
                        ? "true"
                        : value === false
                        ? "false"
                        : value === null
                        ? <span className="text-gray-500">&lt;null&gt;</span>
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
        <div className="mx-4 my-2 px-4 py-2 text-sm text-gray-300">
          {res.rows.length} rows
        </div>
      )}
    </div>
  );
}

export default App;

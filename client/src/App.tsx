import { useEffect, useRef, useState } from "react";
import { get, post } from "./api.ts";

import Navbar from "./components/Navbar.tsx";
import Editor from "./components/Editor.tsx";

function App() {
  const editorRef = useRef<any | null>(null);
  const [res, setRes] = useState<any | null>(null);
  const [tables, setTables] = useState<any | null>(null);
  const [databases, setDatabases] = useState(null);
  const [schemas, setSchemas] = useState(null);
  const [error, setError] = useState<string | null>(null);

  // TODO: more ergonomic API for reading rows from server
  // TODO: fetch available schemas and databases
  // TODO: switch between multiple connections
  useEffect(() => {
    (async () => {
      const databases = await get("/db/databases");
      const schemas = await get("/db/schemas");
      const tables = await get("/db/tables");

      setDatabases(databases);
      setSchemas(schemas);
      setTables(tables);

      setRes(databases);
    })();
  }, []);

  async function dispatchQuery() {
    const query = editorRef.current!.getContents();
    try {
      const res = await post("/query", { query });
      setError(null);
      setRes(res);
    } catch (err) {
      console.log("caught");
      setError((err as any).message);
      setRes(null);
    }
  }

  console.log({ res });

  return (
    <div className="flex flex-col items-stretch w-screen h-screen">
      <Navbar />
      <Editor
        ref={editorRef}
        onClick={dispatchQuery}
        onClickLabel="Query ⌘⏎"
        sidebar={
          <div className="w-[300px] border-r-2 border-gray-700 overflow-auto">
            <ul className="menu w-full">
              {!tables
                ? (
                  <li>
                    <span className="loading loading-infinity loading-xl" />
                  </li>
                )
                : tables.rows.map((row) => (
                  <li key={row[2]}>
                    <button
                      type="button"
                      onClick={() => {
                        editorRef.current.insert(row[2]);
                        editorRef.current.focus();
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
            <select className="select select-xs select-ghost m-2 w-[200px]">
              <option value="default">
                default
              </option>
            </select>

            <select
              disabled={!databases}
              className="select select-xs select-ghost m-2 w-[200px]"
            >
              {databases?.rows.map((row) => (
                <option key={row[1]} value={row[1]}>
                  {row[1]}
                </option>
              ))}
            </select>

            <select
              disabled={!schemas}
              className="select select-xs select-ghost m-2 w-[200px]"
            >
              {schemas?.rows.map((row) => (
                <option key={row[1]} value={row[1]}>
                  {row[1]}
                </option>
              ))}
            </select>
          </>
        }
      />

      <div className="divider m-0" />

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

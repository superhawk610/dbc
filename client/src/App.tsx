import { useEffect, useRef, useState } from "react";
import { get, post } from "./api.ts";

import Navbar from "./components/Navbar.tsx";
import Editor from "./components/Editor.tsx";

function App() {
  const editorRef = useRef<any | null>(null);
  const [res, setRes] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      const res = await get("/");
      setRes(res);
    })();
  }, []);

  async function dispatchQuery() {
    const query = editorRef.current!.getContents();
    const res = await post("/query", { query });
    setRes(res);
  }

  return (
    <div className="flex flex-col items-stretch w-screen h-screen">
      <Navbar />
      <Editor ref={editorRef} />
      <div className="flex flex-row justify-end gap-1 py-2 px-4">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={dispatchQuery}
        >
          Query
        </button>
      </div>

      <div className="divider" />

      <div className="card shadow-xl m-2 overflow-auto">
        {res && (
          <table className="table table-zebra table-pin-rows table-compact">
            <thead>
              <tr>
                {res.columns.map((column: string) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {res.rows.map((row: any, idx: number) => (
                <tr key={idx}>
                  {row.map((value: any, idx: number) => (
                    <td key={idx}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={res.columns.length}>
                  {res.rows.length} rows
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

export default App;

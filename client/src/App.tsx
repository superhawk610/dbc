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
      <Editor
        ref={editorRef}
        onClick={dispatchQuery}
        onClickLabel="Query ⌘⏎"
      />
      <div className="divider" />

      <div className="card shadow-xl m-2 overflow-auto">
        {res && (
          <table className="table table-zebra table-pin-rows table-compact">
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
            <tbody>
              {res.rows.map((row: any, idx: number) => (
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
        )}
      </div>

      <div className="m-4 text-sm text-gray-300">
        {res.rows.length} rows
      </div>
    </div>
  );
}

export default App;

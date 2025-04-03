import { useEffect, useState } from "react";
import { get } from "./api.ts";

import Navbar from "./components/Navbar.tsx";

function App() {
  const [count, setCount] = useState(0);
  const [res, setRes] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      const res = await get("/");
      setRes(res);
    })();
  }, []);

  return (
    <div className="flex flex-col items-stretch w-screen h-screen">
      <Navbar />

      <div className="card shadow-xl m-2">
        <div className="card-body">
          <h2 className="card-title">Hello World</h2>
          <div className="card-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCount((count) => count + 1)}
            >
              count is {count}
            </button>
          </div>
        </div>
      </div>

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

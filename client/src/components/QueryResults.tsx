import { PaginatedQueryResult, QueryValue } from "../models/query.ts";

export interface Props {
  page: PaginatedQueryResult | null;
  error: string | null;
}

export default function QueryResults({ page, error }: Props) {
  if (error) {
    return (
      <p className="mt-4 px-6 font-mono text-error text-sm">
        {error}
      </p>
    );
  }

  if (!page) {
    return <p className="mt-4 px-6 text-sm">No results.</p>;
  }

  return (
    <div className="flex-1 overflow-auto bg-base-300">
      <table className="table table-sm table-zebra table-pin-rows table-compact rounded-none bg-base-100 whitespace-nowrap">
        <thead>
          <tr>
            {page.entries.columns.map((column, idx) => (
              <th
                key={`${column.name}-${idx}`}
                className="bg-neutral/70 text-neutral-content font-semibold"
              >
                {column.name}
                <div className="font-normal text-xs text-neutral-content/60">
                  {column.type}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.entries.rows.length === 0
            ? (
              <tr>
                <td colSpan={page.entries.columns.length}>
                  No results.
                </td>
              </tr>
            )
            : page.entries.rows.map((row, idx) => (
              <tr key={idx}>
                {row.map((value: QueryValue, idx: number) => (
                  <td key={idx} className="border-r border-neutral-500/10">
                    {value === true
                      ? "true"
                      : value === false
                      ? "false"
                      : value === null
                      ? (
                        <span className="text-base-content/40">
                          &lt;null&gt;
                        </span>
                      )
                      : (Array.isArray(value) || typeof value === "object")
                      ? (
                        <span className="font-mono">
                          {JSON.stringify(value, null, 2)}
                        </span>
                      )
                      : value}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

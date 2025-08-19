import { HiArrowRight as ForeignKeyIcon } from "react-icons/hi";
import {
  PaginatedQueryResult,
  QueryColumn,
  QueryValue,
} from "../models/query.ts";

export interface Props {
  page: PaginatedQueryResult | null;
  error: string | null;
  onForeignKeyClick: (column: QueryColumn, value: QueryValue) => void;
}

export default function QueryResults(
  { page, error, onForeignKeyClick }: Props,
) {
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
                <div className="flex items-center">
                  {column.name}
                  {column.fk_constraint && (
                    <span
                      title={`FK: ${column.fk_constraint}\n→ ${column.fk_table}.${column.fk_column}`}
                      className="ml-1 h-3 w-3 flex items-center justify-center bg-accent text-accent-content rounded-full"
                    >
                      <ForeignKeyIcon className="h-2 w-2" />
                    </span>
                  )}
                </div>
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
                {row.map((value: QueryValue, idx: number) => {
                  const column = page.entries.columns[idx];

                  return (
                    <td key={idx} className="border-r border-neutral-500/10">
                      <div className="flex items-center justify-between">
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

                        {column.fk_constraint && (
                          <button
                            type="button"
                            className="ml-1 h-3 w-3 flex items-center justify-center bg-neutral/20 rounded-full cursor-pointer"
                            onClick={() => onForeignKeyClick(column, value)}
                          >
                            <ForeignKeyIcon className="h-2 w-2" />
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

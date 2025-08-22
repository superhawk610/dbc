import { useEffect, useRef } from "react";
import {
  HiArrowDown as SortDescIcon,
  HiArrowRight as ForeignKeyIcon,
  HiArrowUp as SortAscIcon,
  HiDocumentDuplicate as CopyIcon,
} from "react-icons/hi";
import {
  PaginatedQueryResult,
  QueryColumn,
  QueryValue,
} from "../models/query.ts";

interface TimerInterval {
  since: number;
  interval: number;
}

export interface Props {
  page: PaginatedQueryResult | null;
  error: string | null;
  loading?: boolean;
  onCancel: () => void;
  onToggleSort: (column_idx: number, direction: "ASC" | "DESC") => void;
  onForeignKeyClick: (column: QueryColumn, value: QueryValue) => void;
}

export default function QueryResults(
  { page, error, loading, onCancel, onToggleSort, onForeignKeyClick }: Props,
) {
  const timerRef = useRef<HTMLDivElement | null>(null);
  const timerIntervalRef = useRef<TimerInterval | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function cleanUp() {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current.interval);
      }
      if (timerRef.current) {
        timerRef.current.textContent = "";
      }
      cancelButtonRef.current?.classList.add("hidden");
    }

    if (loading) {
      timerIntervalRef.current = {
        since: Date.now(),
        interval: setInterval(() => {
          const elapsedMs = Date.now() - timerIntervalRef.current!.since;

          // don't show timer until it's been running for at least 3s
          if (elapsedMs < 3_000) return;

          cancelButtonRef.current?.classList.remove("hidden");

          // show timer in seconds with 1 decimal place, until it hits 10s,
          // then show it in whole seconds
          const s = Math.floor(elapsedMs / 100) / 10;
          timerRef.current!.textContent = s > 10
            ? `${Math.floor(s)}s`
            : `${s.toFixed(1)}s`;
        }, 100),
      };
    } else {
      cleanUp();
    }

    return cleanUp;
  }, [loading]);

  if (error) {
    return (
      <p className="mt-4 px-6 font-mono text-error text-sm">
        {error}
      </p>
    );
  }

  if (!page) {
    return (
      <div
        className={`h-full flex flex-col items-center justify-center mt-4 px-6 text-sm ${
          loading ? "opacity-60" : ""
        }`}
      >
        <div>
          {loading ? "Loading results" : "No results."}
          {loading && (
            <span className="ml-2 loading loading-infinity loading-sm" />
          )}
        </div>

        <div className="mt-1 opacity-70" ref={timerRef} />

        <button
          type="button"
          className="mt-2 btn btn-circle btn-ghost btn-xs hidden"
          ref={cancelButtonRef}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex-1 overflow-auto bg-base-300 ${
        loading ? "opacity-30" : ""
      }`}
    >
      <table className="table table-sm table-zebra table-pin-rows table-compact rounded-none bg-base-100 whitespace-nowrap">
        <thead>
          <tr>
            {page.entries.columns.map((column, idx) => (
              <th
                key={`${column.name}-${idx}`}
                className="bg-neutral text-neutral-content font-semibold"
              >
                <div className="flex items-center">
                  <button
                    type="button"
                    title="Sort by this column"
                    className="cursor-pointer -ml-1 px-1 rounded-sm hover:bg-neutral/30"
                    onClick={() =>
                      onToggleSort(
                        idx,
                        page.sort?.column_idx === idx &&
                          page.sort.direction === "ASC"
                          ? "DESC"
                          : "ASC",
                      )}
                  >
                    {column.name}
                  </button>

                  {column.fk_constraint && (
                    <span
                      title={`FK: ${column.fk_constraint}\n→ ${column.fk_table}.${column.fk_column}`}
                      className="ml-1 h-3 w-3 flex items-center justify-center bg-accent text-accent-content rounded-full"
                    >
                      <ForeignKeyIcon className="h-2 w-2" />
                    </span>
                  )}

                  {page.sort?.column_idx === idx && (
                    <span className="ml-1 h-3 w-3 flex items-center justify-center bg-primary text-primary-content rounded-full">
                      {page.sort.direction === "ASC"
                        ? <SortAscIcon className="h-2 w-2" />
                        : <SortDescIcon className="h-2 w-2" />}
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
                      <div className="group flex items-center justify-between">
                        {value === true
                          ? "true"
                          : value === false
                          ? "false"
                          : value === null
                          ? (
                            <span className="text-base-content/40">
                              null
                            </span>
                          )
                          : (Array.isArray(value) || typeof value === "object")
                          ? (
                            <span className="font-mono">
                              {JSON.stringify(value, null, 2)}
                            </span>
                          )
                          : value}

                        <div className="ml-2 flex items-center gap-1.5 transition-opacity opacity-0 group-hover:opacity-100 ">
                          {value !== null && (
                            <button
                              type="button"
                              title="Copy to clipboard"
                              className="h-4 w-4 flex items-center justify-center bg-neutral/20 rounded-full cursor-pointer"
                              onClick={() =>
                                navigator.clipboard.writeText(
                                  (Array.isArray(value) ||
                                      typeof value === "object")
                                    ? JSON.stringify(value, null, 2)
                                    : value.toString(),
                                )}
                            >
                              <CopyIcon className="h-3 w-3" />
                            </button>
                          )}

                          {column.fk_constraint && value !== null && (
                            <button
                              type="button"
                              title="Query foreign key value"
                              className="h-4 w-4 flex items-center justify-center bg-neutral/20 rounded-full cursor-pointer"
                              onClick={() => onForeignKeyClick(column, value)}
                            >
                              <ForeignKeyIcon className="h-3 w-3" />
                            </button>
                          )}
                        </div>
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

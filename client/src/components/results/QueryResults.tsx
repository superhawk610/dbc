import { useEffect, useRef, useState } from "react";
import {
  HiArrowDown as SortDescIcon,
  HiArrowRight as ForeignKeyIcon,
  HiArrowUp as SortAscIcon,
  HiDocumentDuplicate as CopyIcon,
  HiEye as ViewIcon,
  HiFilter as FilterIcon,
} from "react-icons/hi";
import {
  columnFilter,
  columnLabel,
  Filter,
  PaginatedQueryResult,
  QueryColumn,
  QueryValue,
} from "../../models/query.ts";
import Filters from "./Filters.tsx";
import ExplainVisualize from "../explain/ExplainVisualize.tsx";
import ContextMenu, { Item, useContextMenu } from "../ContextMenu.tsx";
import useClickAway from "../../hooks/useClickAway.ts";

const SHOW_CELL_HOVER = false;

interface TimerInterval {
  since: number;
  interval: number;
}

export function stringifyValue(value: QueryValue) {
  return (Array.isArray(value) || typeof value === "object")
    ? JSON.stringify(value, null, 2)
    : value.toString();
}

function copyToClipboard(value: QueryValue) {
  navigator.clipboard.writeText(stringifyValue(value));
}

export interface Props {
  page: PaginatedQueryResult | null;
  filters: Filter[];
  error: string | null;
  loading?: boolean;
  onCancel: () => void;
  onFilterChange: (filters: Filter[]) => void;
  onFilterApply: (filters: Filter[]) => void;
  onToggleSort: (column_idx: number, direction: "ASC" | "DESC" | null) => void;
  onForeignKeyClick: (column: QueryColumn, value: QueryValue) => void;
  onViewValueClick: (value: QueryValue) => void;
}

export default function QueryResults({
  page,
  filters,
  error,
  loading,
  onCancel,
  onFilterChange,
  onFilterApply,
  onToggleSort,
  onForeignKeyClick,
  onViewValueClick,
}: Props) {
  const timerRef = useRef<HTMLDivElement | null>(null);
  const timerIntervalRef = useRef<TimerInterval | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const [activeCell, setActiveCell] = useState<
    { row: number; col: number } | null
  >(null);

  const containerRef = useClickAway<HTMLTableSectionElement>(() =>
    setActiveCell(null)
  );

  const { props: contextMenuProps, onContextMenu } = useContextMenu();

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
      <p className="py-4 px-6 font-mono text-error text-sm">
        {error}
      </p>
    );
  }

  if (!page) {
    return (
      <div
        className={`h-full flex flex-col items-center justify-center py-4 px-6 text-sm ${
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

  if (page.type === "explain") {
    return <ExplainVisualize plan={page.plan} query={page.query} />;
  }

  if (page.type === "modify-data" || page.type === "modify-structure") {
    return (
      <div className="py-4 px-6 text-sm">
        <span>Success!</span>
        {page.type === "modify-data" &&
          (
            <span className="opacity-40 pl-1">
              Updated {page.affected_rows}{" "}
              row{page.affected_rows === 1 ? "" : "s"}.
            </span>
          )}
      </div>
    );
  }

  return (
    <>
      <ContextMenu
        {...contextMenuProps}
        getItems={(itemContext) => {
          switch (itemContext!.type) {
            case "header":
              return [
                { id: "filter", label: "Filter..." },
                { id: "sort-asc", label: "Sort ascending" },
                { id: "sort-desc", label: "Sort descending" },
                { id: "sort-none", label: "Disable sorting" },
              ];
            case "cell": {
              const items: Item[] = [];

              if (itemContext.value !== null) {
                items.push(
                  { id: "copy", label: "Copy" },
                  { id: "view", label: "Open in editor" },
                );
              }

              items.push({ id: "filter-add", label: "Add to filters" });

              if (
                itemContext.column!.fk_constraint && itemContext.value !== null
              ) {
                items.push({
                  id: "foreign-key",
                  label: "Query foreign key value",
                });
              }

              return items;
            }
            default:
              throw new Error("unreachable");
          }
        }}
        onClick={(id, itemContext) => {
          switch (id) {
            case "filter":
              return onFilterChange([...filters, {
                type: itemContext!.column.type,
                index: itemContext!.idx,
                column: itemContext!.column.name,
                label: columnLabel(itemContext!.column),
                operator: "eq",
                value: "",
              }]);

            case "filter-add": {
              const newFilters = [
                ...filters,
                columnFilter(itemContext!.column, itemContext!.value),
              ];
              onFilterChange(newFilters);
              onFilterApply(newFilters);
              return;
            }

            case "foreign-key":
              return onForeignKeyClick(itemContext!.column, itemContext!.value);

            case "sort-asc":
              return onToggleSort(itemContext!.idx, "ASC");

            case "sort-desc":
              return onToggleSort(itemContext!.idx, "DESC");

            case "sort-none":
              return onToggleSort(itemContext!.idx, null);

            case "copy":
              return copyToClipboard(itemContext!.value);

            case "view":
              return onViewValueClick(itemContext!.value);

            default:
              throw new Error("unreachable");
          }
        }}
      />

      <Filters
        filters={filters}
        columns={page.entries.columns}
        onChange={onFilterChange}
        onApply={onFilterApply}
      />

      <div
        className={`flex-1 overflow-auto bg-base-300 ${
          loading ? "opacity-30" : ""
        }`}
      >
        <table className="table table-sm table-zebra table-pin-rows table-compact rounded-none bg-base-100 whitespace-nowrap">
          <thead>
            <tr className="z-20">
              {page.entries.columns.map((column, idx) => (
                <th
                  key={`${column.name}-${idx}`}
                  className="bg-neutral text-neutral-content font-semibold"
                  onContextMenu={onContextMenu({ type: "header", column, idx })}
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
          <tbody ref={containerRef}>
            {page.entries.rows.length === 0
              ? (
                <tr>
                  <td colSpan={page.entries.columns.length}>
                    No results.
                  </td>
                </tr>
              )
              : page.entries.rows.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  {row.map((value: QueryValue, colIdx: number) => {
                    const column = page.entries.columns[colIdx];

                    return (
                      <td
                        key={colIdx}
                        // `overflow-hidden` is required to keep the hover
                        // effect from spilling into other cells, but it prevents
                        // the active ring from showing
                        className={`relative ${
                          SHOW_CELL_HOVER ? "overflow-hidden" : ""
                        } cursor-default border-r border-neutral-500/10 ${
                          activeCell?.row === rowIdx ? "bg-primary/30" : ""
                        }`}
                        onClick={() =>
                          setActiveCell({ row: rowIdx, col: colIdx })}
                        onContextMenu={(ev) => {
                          setActiveCell({ row: rowIdx, col: colIdx });
                          onContextMenu({ type: "cell", column, value })(ev);
                        }}
                        onDoubleClick={(ev) => {
                          ev.preventDefault();

                          // select all cell text on double click
                          const sel = globalThis.getSelection();
                          const range = document.createRange();
                          range.selectNodeContents(ev.target as Node);
                          sel!.removeAllRanges();
                          sel!.addRange(range);
                        }}
                      >
                        {activeCell?.row === rowIdx &&
                          activeCell?.col === colIdx && (
                          <div className="absolute pointer-events-none z-10 inset-0 ring-2 ring-primary" />
                        )}
                        <div className="flex items-center justify-between overflow-hidden">
                          <div
                            className={`truncate ${
                              page.entries.columns.length > 1
                                ? "max-w-[600px]"
                                : "max-w-[98vw]"
                            }`}
                          >
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
                              : (Array.isArray(value) ||
                                  typeof value === "object")
                              ? (
                                <span className="font-mono">
                                  {JSON.stringify(value, null, 2)}
                                </span>
                              )
                              : value}
                          </div>

                          {SHOW_CELL_HOVER && (
                            <div className="absolute top-0 right-0 z-10 h-full flex items-center gap-1.5
                            pr-2 pl-6 bg-gradient-to-l from-base-100 to-transparent
                            transition-opacity opacity-0 hover:opacity-100">
                              <button
                                type="button"
                                title="Add to filters"
                                className="h-4 w-4 flex items-center justify-center bg-primary-content text-primary rounded-full cursor-pointer"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  const newFilters = [
                                    ...filters,
                                    columnFilter(
                                      column,
                                      value as string | null,
                                    ),
                                  ];
                                  onFilterChange(newFilters);
                                  onFilterApply(newFilters);
                                }}
                              >
                                <FilterIcon className="h-3 w-3" />
                              </button>

                              {value !== null && (
                                <button
                                  type="button"
                                  title="View in editor"
                                  className="h-4 w-4 flex items-center justify-center bg-primary-content text-primary rounded-full cursor-pointer"
                                  onClick={() => onViewValueClick(value)}
                                >
                                  <ViewIcon className="h-3 w-3" />
                                </button>
                              )}

                              {value !== null && (
                                <button
                                  type="button"
                                  title="Copy to clipboard"
                                  className="h-4 w-4 flex items-center justify-center bg-primary-content text-primary rounded-full cursor-pointer"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    copyToClipboard(value);
                                  }}
                                >
                                  <CopyIcon className="h-3 w-3" />
                                </button>
                              )}

                              {column.fk_constraint && value !== null && (
                                <button
                                  type="button"
                                  title="Query foreign key value"
                                  className="h-4 w-4 flex items-center justify-center bg-primary-content text-primary rounded-full cursor-pointer"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    onForeignKeyClick(column, value);
                                  }}
                                >
                                  <ForeignKeyIcon className="h-3 w-3" />
                                </button>
                              )}
                            </div>
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
    </>
  );
}

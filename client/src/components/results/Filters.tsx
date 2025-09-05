import { produce } from "immer";
import {
  columnLabel,
  Filter,
  FILTER_OPS,
  QueryColumn,
} from "../../models/query.ts";
import { HiMinus as MinusIcon, HiPlus as PlusIcon } from "react-icons/hi";

export interface Props {
  columns: QueryColumn[];
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
  onApply: (filters: Filter[]) => void;
}

export default function Filters(
  { columns, filters, onChange, onApply }: Props,
) {
  if (filters.length === 0) return null;

  // sort column names alphabetically
  const sortedColumns = columns.map((col) => ({
    ...col,
    label: columnLabel(col),
  })).toSorted((a, b) => a.label.localeCompare(b.label));

  return (
    <ul className="bg-base-100 p-1.5 pr-4 space-y-1">
      {filters.map((filter, idx) => (
        <li key={idx} className="flex justify-end gap-1">
          <select
            className="select select-xs bg-base-200 text-base-content px-2 py-1 rounded border-0 focus:outline-0"
            value={`${filter.index}.${filter.column}`}
            onChange={(e) =>
              onChange(produce(filters, (draft) => {
                const [index, column] = e.target.value.split(".");
                draft[idx].column = column;
                draft[idx].index = parseInt(index);
              }))}
          >
            {sortedColumns.map((col) => (
              <option
                key={`${col.index}.${col.name}`}
                value={`${col.index}.${col.name}`}
              >
                {col.label}
              </option>
            ))}
          </select>
          <select
            className="w-[200px] select select-xs bg-base-200 text-base-content px-2 py-1 rounded border-0 focus:outline-0"
            value={filter.operator ?? "eq"}
            onChange={(e) =>
              onChange(produce(filters, (draft) => {
                draft[idx].operator = e.target.value as Filter["operator"];
                if (["null", "not_null"].includes(e.target.value)) {
                  draft[idx].value = "";
                }
              }))}
          >
            {FILTER_OPS.map((op) => (
              <option key={op.op} value={op.op}>
                {op.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            disabled={["null", "not_null"].includes(filter.operator)}
            value={String(filter.value)}
            className="w-[300px] bg-base-200 text-base-content text-xs px-2 py-1 rounded outline-0
            disabled:opacity-50 disabled:cursor-not-allowed"
            onChange={(e) =>
              onChange(produce(filters, (draft) => {
                switch (filter.type) {
                  case "bool":
                    draft[idx].value = ["true", "t", "1", "y", "yes"].includes(
                      e.target.value.toLowerCase(),
                    );
                    break;
                  case "int4":
                  case "int8":
                  case "numeric":
                    draft[idx].value = Number(e.target.value);
                    break;
                  default:
                    draft[idx].value = e.target.value;
                }
              }))}
          />
          <button
            type="button"
            className="btn btn-xs btn-ghost px-0 rounded-sm ml-1 text-base-content"
            onClick={() =>
              onChange([...filters, {
                type: sortedColumns[0].type,
                column: sortedColumns[0].name,
                index: sortedColumns[0].index,
                label: columnLabel(sortedColumns[0]),
                operator: "eq",
                value: "",
              }])}
          >
            <PlusIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn btn-xs btn-ghost px-0 rounded-sm text-base-content"
            onClick={() => {
              onChange(filters.filter((_, i) =>
                i !== idx
              ));

              // if we're removing the last filter, dispatch the query
              // (the Apply button will no longer be visible)
              if (filters.length === 1) {
                onApply([]);
              }
            }}
          >
            <MinusIcon className="h-4 w-4" />
          </button>
        </li>
      ))}
      <li className="flex justify-end gap-1">
        <button
          type="button"
          className="btn btn-xs btn-base-200 rounded-sm px-4"
          onClick={() => {
            onChange([]);
            onApply([]);
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="btn btn-xs btn-primary rounded-sm px-4"
          onClick={() => onApply(filters)}
        >
          Apply
        </button>
      </li>
    </ul>
  );
}

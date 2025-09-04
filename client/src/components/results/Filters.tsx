import { produce } from "immer";
import { Filter, QueryColumn } from "../../models/query.ts";
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

  return (
    <ul className="bg-base-100 p-1.5 pr-4 space-y-1">
      {filters.map((filter, idx) => (
        <li key={idx} className="flex justify-end gap-1">
          <select
            className="select select-xs bg-base-200 text-base-content px-2 py-1 rounded border-0 focus:outline-0"
            value={filter.column ?? columns[0].name}
            onChange={(e) =>
              onChange(produce(filters, (draft) => {
                draft[idx].column = e.target.value;
              }))}
          >
            {columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select
            className="select select-xs bg-base-200 text-base-content px-2 py-1 rounded border-0 focus:outline-0"
            value={filter.operator ?? "eq"}
            onChange={(e) =>
              onChange(produce(filters, (draft) => {
                draft[idx].operator = e.target.value as Filter["operator"];
                if (["null", "not_null"].includes(e.target.value)) {
                  draft[idx].value = "";
                }
              }))}
          >
            <option value="eq">equals</option>
            <option value="neq">not equals</option>
            <option value="null">is null</option>
            <option value="not_null">is not null</option>
          </select>
          <input
            type="text"
            disabled={["null", "not_null"].includes(filter.operator)}
            value={filter.value}
            className="w-[300px] bg-base-200 text-base-content text-xs px-2 py-1 rounded outline-0
            disabled:opacity-50 disabled:cursor-not-allowed"
            onChange={(e) =>
              onChange(produce(filters, (draft) => {
                draft[idx].value = e.target.value;
              }))}
          />
          <button
            type="button"
            className="btn btn-xs btn-ghost px-0 ml-1 text-base-content"
            onClick={() =>
              onChange([...filters, {
                column: columns[0].name,
                operator: "eq",
                value: "",
              }])}
          >
            <PlusIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn btn-xs btn-ghost px-0 text-base-content"
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

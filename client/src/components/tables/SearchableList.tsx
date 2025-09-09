import { useState } from "react";
import {
  HiCollection as MaterializedViewIcon,
  HiMenu as TableIcon,
  HiOutlineCollection as ViewIcon,
  HiSearch as SearchIcon,
  HiX as XIcon,
} from "react-icons/hi";

export type ListItemIcon = "table" | "view" | "materialized_view";

export interface ListItem<T> {
  text: string;
  icon?: ListItemIcon;
  accent?: string;
  inner: T;
}

export interface Props<T> {
  items: ListItem<T>[];
  loading: boolean;
  onClick: (item: T) => void;
  onContextMenu?: (ev: React.MouseEvent, item: T) => void;
}

export default function SearchableList<T>(
  { items, loading, onClick, onContextMenu }: Props<T>,
) {
  const [query, setQuery] = useState("");

  const lowerQuery = query.toLowerCase();
  const filteredItems = items.filter((item) =>
    item.text.toLowerCase().includes(lowerQuery)
  );

  return (
    <>
      <div className="p-2 bg-neutral/20 shadow-lg">
        <label className="input input-ghost input-sm w-full px-2 py-1 rounded-lg
        hover:bg-neutral/40 focus-within:bg-neutral/30 focus-within:outline-none">
          <SearchIcon />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-xs rounded-sm"
              onClick={() => setQuery("")}
            >
              <XIcon />
            </button>
          )}
        </label>
      </div>

      <div className="flex-grow basis-0 overflow-y-auto overflow-x-hidden pt-1">
        {loading
          ? (
            <div className="flex flex-col items-center justify-center h-full">
              <span className="loading loading-infinity loading-xl" />
              <p className="text-xs text-neutral-content/60">Loading</p>
            </div>
          )
          : (
            <ul className="pr-0 w-full menu text-xs">
              {filteredItems.length === 0
                ? (
                  <li className="p-4 opacity-50">
                    No results
                  </li>
                )
                : filteredItems.map((item) => (
                  <li key={item.text} className="w-full">
                    <button
                      type="button"
                      title={item.text}
                      className="block w-full overflow-hidden"
                      onClick={() =>
                        onClick(item.inner)}
                      onContextMenu={(ev) =>
                        onContextMenu?.(ev, item.inner)}
                    >
                      <div className="flex items-center gap-2">
                        {item.icon && (
                          <div className="flex-shrink-0">
                            {item.icon === "table"
                              ? <TableIcon />
                              : item.icon === "view"
                              ? <ViewIcon />
                              : <MaterializedViewIcon />}
                          </div>
                        )}
                        <span className="truncate flex-1">{item.text}</span>
                        {item.accent && (
                          <span className="text-xs opacity-40">
                            {item.accent}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
            </ul>
          )}
      </div>
    </>
  );
}

import { useState } from "react";
import { HiSearch as SearchIcon, HiX as XIcon } from "react-icons/hi";

export interface Props {
  items: string[];
  loading: boolean;
  onClick: (item: string) => void;
}

export default function SearchableList({ items, loading, onClick }: Props) {
  const [query, setQuery] = useState("");

  const lowerQuery = query.toLowerCase();
  const filteredItems = items.filter((item) =>
    item.toLowerCase().includes(lowerQuery)
  );

  return (
    <>
      <div className="p-2 bg-neutral/20 shadow-lg">
        <label className="input input-ghost input-sm px-2 py-1 rounded-lg
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
              className="btn btn-circle btn-ghost btn-xs"
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
            <ul className="pt-0 w-full menu text-xs">
              {items.length === 0
                ? (
                  <li className="p-4 opacity-50">
                    No results
                  </li>
                )
                : filteredItems.map((item) => (
                  <li key={item} className="w-full">
                    <button
                      type="button"
                      title={item}
                      onClick={() => onClick(item)}
                      className="block w-full overflow-hidden truncate"
                    >
                      {item}
                    </button>
                  </li>
                ))}
            </ul>
          )}
      </div>
    </>
  );
}

import {
  HiChevronLeft as LeftIcon,
  HiChevronRight as RightIcon,
} from "react-icons/hi";

import { QueryResult } from "../models/query.ts";

export interface Props {
  result: QueryResult;
}

export default function Pagination({ result }: Props) {
  return (
    <div className="flex items-center space-x-2 p-4 text-sm bg-neutral/20 text-base-content/80">
      <div className="mr-auto">
        {result.rows.length} rows
      </div>
      <div className="flex items-center space-x-1">
        <span>Page</span>
        <select
          defaultValue={1}
          className="cursor-pointer hover:bg-white/10 rounded-full px-2 py-1 text-center select-ghost appearance-none focus:bg-white/10"
        >
          <option value={1}>1</option>
        </select>
        <span>of</span>
        <span className="ml-1">1</span>
      </div>
      <div className="flex items-center">
        <button
          type="button"
          className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-full hover:bg-white/10 active:bg-white/20"
        >
          <LeftIcon />
        </button>
        <button
          type="button"
          className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-full hover:bg-white/10 active:bg-white/20"
        >
          <RightIcon />
        </button>
      </div>
      <div className="flex items-center space-x-2">
        <select
          defaultValue={25}
          className="cursor-pointer hover:bg-white/10 rounded-full px-2 py-1 text-center select-ghost appearance-none focus:bg-white/10"
        >
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
        <span>rows per page</span>
      </div>
    </div>
  );
}

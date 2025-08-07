import {
  HiChevronLeft as LeftIcon,
  HiChevronRight as RightIcon,
} from "react-icons/hi";

import { PaginatedQueryResult } from "../models/query.ts";

export interface Props {
  page: PaginatedQueryResult;
}

export default function Pagination({ page }: Props) {
  return (
    <div className="flex items-center space-x-2 p-4 text-sm bg-neutral/20 text-base-content/80">
      <div className="mr-auto">
        {page.page_count} of {page.total_count} rows
      </div>
      <div className="flex items-center space-x-1">
        <span>Page</span>
        <select
          defaultValue={1}
          className="cursor-pointer hover:bg-white/10 rounded-full px-2 py-1 text-center select-ghost appearance-none focus:bg-white/10"
        >
          <option value={1}>{page.page}</option>
        </select>
        <span>of</span>
        <span className="ml-1">{page.total_pages}</span>
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
          defaultValue={page.page_size}
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

import {
  HiChevronDoubleLeft as FirstIcon,
  HiChevronDoubleRight as LastIcon,
  HiChevronLeft as LeftIcon,
  HiChevronRight as RightIcon,
} from "react-icons/hi";

import { PaginatedSelectQueryResult } from "../models/query.ts";

const fmt = (n: number) => new Intl.NumberFormat().format(n);

export interface Props {
  query: PaginatedSelectQueryResult;
  page: number;
  pageSize: number;
  loading?: boolean;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
}

export default function Pagination(
  { query, page, pageSize, loading, setPage, setPageSize }: Props,
) {
  const firstRow = (query.page - 1) * query.page_size + 1;
  const lastRow = Math.min(firstRow + query.page_size - 1, query.total_count);
  return (
    <div data-wry-drag-region className="flex flex-1 items-center gap-2">
      <div className="mr-auto">
        Showing {fmt(firstRow)} - {fmt(lastRow)} of {fmt(query.total_count)}
        {" "}
        rows

        {loading && (
          <span className="ml-4 text-sm opacity-50">
            Loading results
            <span className="ml-2 loading loading-sm loading-infinity"></span>
          </span>
        )}
      </div>
      <div className="flex items-center space-x-1">
        <span>Page</span>
        <select
          value={page}
          onChange={(ev) => setPage(Number(ev.target.value))}
          className="cursor-pointer hover:bg-white/10 rounded-full px-2 py-1 text-center select-ghost appearance-none focus:bg-white/10"
        >
          {new Array(query.total_pages).fill(0).map((_, idx) => (
            <option key={idx} value={idx + 1}>{fmt(idx + 1)}</option>
          ))}
        </select>
        <span>of</span>
        <span className="ml-1">{fmt(query.total_pages)}</span>
      </div>
      <div className="flex items-center">
        <button
          type="button"
          className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-full
          hover:bg-white/10 active:bg-white/20 disabled:opacity-50 disabled:pointer-events-none"
          onClick={() => setPage(1)}
          disabled={page === 1}
        >
          <FirstIcon />
        </button>
        <button
          type="button"
          className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-full
          hover:bg-white/10 active:bg-white/20 disabled:opacity-50 disabled:pointer-events-none"
          onClick={() => setPage(page - 1)}
          disabled={page === 1}
        >
          <LeftIcon />
        </button>
        <button
          type="button"
          className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-full
          hover:bg-white/10 active:bg-white/20 disabled:opacity-50 disabled:pointer-events-none"
          onClick={() => setPage(page + 1)}
          disabled={page === query.total_pages}
        >
          <RightIcon />
        </button>
        <button
          type="button"
          className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-full
          hover:bg-white/10 active:bg-white/20 disabled:opacity-50 disabled:pointer-events-none"
          onClick={() => setPage(query.total_pages)}
          disabled={page === query.total_pages}
        >
          <LastIcon />
        </button>
      </div>
      <div className="flex items-center space-x-2">
        <select
          value={pageSize}
          onChange={(ev) => setPageSize(Number(ev.target.value))}
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

export default interface QueryRow {
  [key: string]: QueryValue;
}

export type QueryValue = string | number | boolean | null | QueryValue[];

export interface QueryColumn {
  type: string;
  name: string;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: QueryValue[][];
}

export interface PaginatedQueryResult {
  page: number;
  page_size: number;
  page_count: number;
  total_count: number;
  total_pages: number;
  entries: QueryResult;
}

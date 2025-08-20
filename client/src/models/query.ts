export default interface QueryRow {
  [key: string]: QueryValue;
}

export type QueryValue = string | number | boolean | null | QueryValue[];

export interface QueryColumn {
  type: string;
  name: string;
  source_table: string | null;
  source_column: string | null;
  fk_constraint: string | null;
  fk_table: string | null;
  fk_column: string | null;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: QueryValue[][];
  is_ddl: boolean;
}

export interface Sort {
  column_idx: number;
  direction: "ASC" | "DESC";
}

export interface PaginatedQueryResult {
  page: number;
  page_size: number;
  page_count: number;
  total_count: number;
  total_pages: number;
  sort: Sort | null;
  entries: QueryResult;
}

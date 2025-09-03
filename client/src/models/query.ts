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
}

export interface Sort {
  column_idx: number;
  direction: "ASC" | "DESC";
}

export type PaginatedQueryResult =
  | PaginatedSelectQueryResult
  | PaginatedModifyDataQueryResult
  | PaginatedModifyStructureQueryResult;

export interface PaginatedSelectQueryResult {
  type: "select";
  page: number;
  page_size: number;
  page_count: number;
  total_count: number;
  total_pages: number;
  sort: Sort | null;
  entries: QueryResult;
}

export interface PaginatedModifyDataQueryResult {
  type: "modify-data";
  affected_rows: number;
}

export interface PaginatedModifyStructureQueryResult {
  type: "modify-structure";
}

export interface QueryParam {
  name: string;
  // TODO: enumerate types
  type: string;
}

export interface PrepareQueryResult {
  columns: QueryColumn[];
  params: QueryParam[];
}

export default interface QueryRow {
  [key: string]: QueryValue;
}

export type QueryValue = string | number | boolean | null | QueryValue[];

export const FILTER_OPS = [
  { op: "eq", label: "equals" },
  { op: "neq", label: "not equals" },
  { op: "like", label: "contains" },
  { op: "not_like", label: "does not contain" },
  { op: "null", label: "is null" },
  { op: "not_null", label: "is not null" },
  { op: "gt", label: "is greater than" },
  { op: "gte", label: "is greater than or equal to" },
  { op: "lt", label: "is less than" },
  { op: "lte", label: "is less than or equal to" },
] as const;

export type ColumnType =
  | "bool"
  | "int4"
  | "int8"
  | "numeric"
  | "text"
  | "timestamp";

export interface Filter {
  type: ColumnType;
  index: number;
  column: string;
  label: string;
  operator: (typeof FILTER_OPS)[number]["op"];
  value: string | number | boolean;
}

export interface QueryColumn {
  type: ColumnType;
  name: string;
  index: number;
  source_table: string | null;
  source_column: string | null;
  fk_constraint: string | null;
  fk_table: string | null;
  fk_column: string | null;
}

export const columnLabel = (column: QueryColumn) => {
  const label = column.source_table
    ? `${column.source_table}.${column.source_column}`
    : column.name;
  return `${label} (${column.type})`;
};

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

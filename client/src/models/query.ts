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

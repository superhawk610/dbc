export default interface Table {
  type: "table" | "view" | "materialized_view";
  table_name: string;
  table_schema: string;
  // Estimated number of rows in table (from pg_class.reltuples)
  table_rows_est: number;
  // Actual size of table in bytes (from pg_total_relation_size)
  table_size: number;
  // Pretty-printed size of table (from pg_size_pretty)
  table_size_pretty: string;
}

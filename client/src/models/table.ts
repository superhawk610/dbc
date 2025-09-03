export default interface Table {
  table_name: string;
  type: "table" | "view" | "materialized_view";
}

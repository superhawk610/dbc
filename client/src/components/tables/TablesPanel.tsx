import SearchableList from "./SearchableList.tsx";
import ContextMenu, { useContextMenu } from "../ContextMenu.tsx";
import Table, { Column } from "../../models/table.ts";
import { get } from "../../api.ts";

const CACHE_TIMEOUT_SECS = 5 * 60;

export interface Props {
  connection: string | null;
  database: string | null;
  tables: Table[];
  loading: boolean;
  onInsertName: (name: string) => void;
  onQueryAll: (name: string) => void;
  onQuery: (name: string) => void;
  onViewDefinition: (table: Table) => void;
}

export default function TablesPanel(
  {
    connection,
    database,
    tables,
    loading,
    onInsertName,
    onQueryAll,
    onQuery,
    onViewDefinition,
  }: Props,
) {
  const { onContextMenu, props: contextMenuProps } = useContextMenu();

  return (
    <>
      <SearchableList
        loading={loading}
        items={tables.map((t) => ({
          text: t.table_name,
          icon: t.type,
          accent: t.table_size_pretty || "--",
          inner: t,
        }))}
        onClick={onViewDefinition}
        onContextMenu={(ev, item) => onContextMenu({ table: item })(ev)}
      />
      <ContextMenu
        {...contextMenuProps}
        width={360}
        getItems={(itemContext) => [
          {
            id: "stats",
            disabled: true,
            label: itemContext!.table.table_rows_est === 0
              ? `Empty ${
                itemContext!.table.type === "table" ? "table" : "view"
              }`
              : `${
                itemContext!.table.type === "table" ? "Table" : "View"
              } contains ~${
                new Intl.NumberFormat().format(
                  itemContext!.table.table_rows_est,
                )
              } row(s)`,
          },
          { id: "divider" },
          {
            id: "query-all",
            label: "Query all rows",
          },
          {
            id: "query",
            label: "Query first 100 rows",
          },
          {
            id: "insert-name",
            label: "Insert name into editor",
          },
          {
            id: "view-definition",
            label: `Open ${
              itemContext!.table.type === "table" ? "table" : "view"
            } definition in editor`,
          },
          { id: "divider" },
          { id: "loading-indicator" },
        ]}
        getItemsExtended={async (itemContext, items) => {
          const columns = await get<Column[]>(
            `/db/schemas/${itemContext!.table.table_schema}/tables/${
              itemContext!.table.table_name
            }/columns`,
            undefined,
            {
              cacheTimeoutSec: CACHE_TIMEOUT_SECS,
              headers: {
                "x-conn-name": connection!,
                "x-database": database!,
              },
            },
          );
          return items.concat(
            {
              id: "scroller",
              maxHeight: 200,
              rows: columns.map((c) => (
                <div
                  className="w-full flex justify-between"
                  key={c.column_name}
                >
                  <span className="truncate">{c.column_name}</span>
                  <span className="ml-2 opacity-50">
                    {c.data_type.toLowerCase()}
                  </span>
                </div>
              )),
            },
          );
        }}
        onClick={(id, itemContext) => {
          switch (id) {
            case "insert-name":
              return onInsertName(itemContext!.table.table_name);

            case "query-all":
              return onQueryAll(itemContext!.table.table_name);

            case "query":
              return onQuery(itemContext!.table.table_name);

            case "view-definition":
              return onViewDefinition(itemContext!.table);

            default:
              throw new Error("unreachable");
          }
        }}
      />
    </>
  );
}

import SearchableList from "./SearchableList.tsx";
import ContextMenu, { useContextMenu } from "../ContextMenu.tsx";
import Table from "../../models/table.ts";

export interface Props {
  tables: Table[];
  loading: boolean;
  onInsertName: (name: string) => void;
  onQueryAll: (name: string) => void;
  onViewDefinition: (table: Table) => void;
}

export default function TablesPanel(
  { tables, loading, onInsertName, onQueryAll, onViewDefinition }: Props,
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
            id: "insert-name",
            label: "Insert name into editor",
          },
          {
            id: "view-definition",
            label: `Open ${
              itemContext!.table.type === "table" ? "table" : "view"
            } definition in editor`,
          },
        ]}
        onClick={(id, itemContext) => {
          switch (id) {
            case "insert-name":
              return onInsertName(itemContext!.table.table_name);

            case "query-all":
              return onQueryAll(itemContext!.table.table_name);

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

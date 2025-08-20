import Connection, {
  connectionColorToClass,
  loadConnectionColors,
} from "../../models/connection.ts";
import useConnectionVersion from "../../hooks/useConnectionVersion.ts";

export interface Props {
  connections: Connection[];
  selected: string | null | undefined;
  onSelect: (name: string) => void;
  onManageConnections: () => void;
}

export default function ConnectionSelect(
  { connections, selected, onSelect, onManageConnections }: Props,
) {
  const colors = loadConnectionColors();
  const connectionInfo = useConnectionVersion(selected);

  return (
    <select
      title="Connection"
      className={`select select-xs select-ghost shrink basis-[250px] ${
        selected
          ? connectionColorToClass(colors[selected])
          : "focus:outline-primary"
      }`}
      value={selected || undefined}
      onChange={(ev: React.ChangeEvent<HTMLSelectElement>) => {
        const value = ev.target.value;
        if (value === "__manage__") {
          onManageConnections();
        } else {
          onSelect(value);
        }
      }}
    >
      {connections.map((connection) => (
        <option key={connection.name} value={connection.name}>
          {connection.name} {connection.name === selected && connectionInfo
            ? `(${connectionInfo})`
            : ""}
        </option>
      ))}
      <option disabled>---</option>
      <option value="__manage__">
        Manage Connections...
      </option>
    </select>
  );
}

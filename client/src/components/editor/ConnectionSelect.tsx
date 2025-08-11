import Connection from "../../models/connection.ts";

export interface Props {
  connections: Connection[];
  selected: string;
  onSelect: (name: string) => void;
  onManageConnections: () => void;
}

export default function ConnectionSelect(
  { connections, selected, onSelect, onManageConnections }: Props,
) {
  return (
    <select
      title="Connection"
      className="select select-xs select-ghost shrink basis-[200px] focus:outline-primary"
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
          {connection.name}
        </option>
      ))}
      <option disabled>---</option>
      <option value="__manage__">
        Manage Connections...
      </option>
    </select>
  );
}

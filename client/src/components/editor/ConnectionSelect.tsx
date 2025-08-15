import { useEffect, useState } from "react";
import Connection from "../../models/connection.ts";
import { get } from "../../api.ts";

export interface Props {
  connections: Connection[];
  selected: string | null;
  onSelect: (name: string) => void;
  onManageConnections: () => void;
}

export default function ConnectionSelect(
  { connections, selected, onSelect, onManageConnections }: Props,
) {
  const [connectionInfo, setConnectionInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;

    (async () => {
      const { info } = await get<{ info: string }>(`/connections/${selected}`);
      const [name, version] = info.split(" ", 3);
      setConnectionInfo(`${name} ${version}`);
    })();
  }, [selected]);

  return (
    <select
      title="Connection"
      className="select select-xs select-ghost shrink basis-[250px] focus:outline-primary"
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
          {connection.name}{" "}
          {connection.name === selected ? `(${connectionInfo})` : ""}
        </option>
      ))}
      <option disabled>---</option>
      <option value="__manage__">
        Manage Connections...
      </option>
    </select>
  );
}

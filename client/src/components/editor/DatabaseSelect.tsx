import Database from "../../models/database.ts";

export interface Props {
  databases: Database[];
  selected: string | null;
  onSelect: (database: string) => void;
}

export default function DatabaseSelect(
  { databases, selected, onSelect }: Props,
) {
  return (
    <select
      title="Database"
      className="select select-xs select-ghost shrink basis-[200px] focus:outline-primary"
      onChange={(ev: React.ChangeEvent<HTMLSelectElement>) =>
        onSelect(ev.target.value)}
      value={selected || undefined}
    >
      {databases.map((database) => (
        <option key={database.datname} value={database.datname}>
          {database.datname}
        </option>
      ))}
    </select>
  );
}

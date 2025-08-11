import Schema from "../../models/schema.ts";

export interface Props {
  schemas: Schema[];
  selected: string | null;
  onSelect: (database: string) => void;
}

export default function SchemaSelect({ schemas, selected, onSelect }: Props) {
  return (
    <select
      title="Schema"
      className="select select-xs select-ghost shrink basis-[200px] focus:outline-primary"
      onChange={(ev: React.ChangeEvent<HTMLSelectElement>) =>
        onSelect(ev.target.value)}
      value={selected || undefined}
    >
      {schemas.map((schema) => (
        <option key={schema.schema_name} value={schema.schema_name}>
          {schema.schema_name}
        </option>
      ))}
    </select>
  );
}

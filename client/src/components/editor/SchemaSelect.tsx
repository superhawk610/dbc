import Schema from "../../models/schema.ts";

const LAST_SCHEMA = "lastSchema";

export function getLastSchema(connection: string, database: string) {
  const json = globalThis.localStorage.getItem(LAST_SCHEMA);
  if (!json) return null;

  return JSON.parse(json)[`${connection}:${database}`];
}

function setLastSchema(connection: string, database: string, schema: string) {
  const json = globalThis.localStorage.getItem(LAST_SCHEMA);
  if (!json) return;

  const parsed = JSON.parse(json);
  parsed[`${connection}:${database}`] = schema;
  globalThis.localStorage.setItem(LAST_SCHEMA, JSON.stringify(parsed));
}

export interface Props {
  connection: string | null | undefined;
  database: string | null;
  schemas: Schema[];
  selected: string | null;
  onSelect: (database: string) => void;
}

export default function SchemaSelect({
  connection,
  database,
  schemas,
  selected,
  onSelect,
}: Props) {
  return (
    <select
      title="Schema"
      className="select select-xs select-ghost shrink basis-[200px] focus:outline-primary"
      onChange={(ev: React.ChangeEvent<HTMLSelectElement>) => {
        const schema = ev.target.value;
        setLastSchema(connection!, database!, schema);
        onSelect(schema);
      }}
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

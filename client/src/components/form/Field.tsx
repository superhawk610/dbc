export interface Props {
  name: string;
  type?: string;
  label?: string;
  defaultValue?: string | number | null | boolean;
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default function Field(
  { name, type = "text", label = capitalize(name), defaultValue }: Props,
) {
  return (
    <label className={type === "checkbox" ? "ml-2" : "floating-label"}>
      <span>{label}</span>
      {type === "checkbox"
        ? (
          <input
            type="checkbox"
            name={name}
            className="checkbox ml-2"
            defaultChecked={defaultValue as (boolean | null | undefined) ||
              undefined}
          />
        )
        : (
          <input
            type={type}
            placeholder={label}
            className="input input-md w-full"
            name={name}
            defaultValue={defaultValue as (
              | string
              | number
              | null
              | undefined
            ) || undefined}
          />
        )}
    </label>
  );
}

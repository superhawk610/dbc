export interface Props {
  name: string;
  type?: string;
  size?: "md" | "xs";
  label?: string;
  defaultValue?: string | number | null;
  defaultChecked?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default function Field(
  {
    name,
    type = "text",
    size = "md",
    label = capitalize(name),
    defaultValue,
    defaultChecked,
    onChange,
  }: Props,
) {
  return (
    <label
      className={type === "checkbox"
        ? `ml-2 block text-nowrap ${size === "xs" ? "text-xs" : ""}`
        : "floating-label"}
    >
      <span>{label}</span>
      {type === "checkbox"
        ? (
          <input
            type="checkbox"
            name={name}
            className={`ml-2 checkbox ${size === "xs" ? "checkbox-xs" : ""}`}
            defaultChecked={defaultChecked}
            onChange={onChange}
          />
        )
        : (
          <input
            type={type}
            placeholder={label}
            className="input input-md w-full"
            name={name}
            defaultValue={defaultValue || undefined}
            onChange={onChange}
          />
        )}
    </label>
  );
}

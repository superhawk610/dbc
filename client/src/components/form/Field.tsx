export interface Props {
  name: string;
  type?: string;
  label?: string;
  defaultValue?: string;
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default function Field(
  { name, type = "text", label = capitalize(name), defaultValue }: Props,
) {
  return (
    <label className="floating-label">
      <span>{label}</span>
      <input
        type={type}
        placeholder={label}
        className="input input-md w-full"
        name={name}
        defaultValue={defaultValue}
      />
    </label>
  );
}

export interface Props {
  name: string;
  color?: string | null;
  label?: string;
}

export default function ColorRadio({ name, color, label }: Props) {
  return (
    <label className="ml-2 flex items-center gap-2">
      <span>{label}</span>

      <input
        type="radio"
        className="radio"
        name={name}
        value="default"
        defaultChecked={!color}
      />
      <input
        type="radio"
        className="radio radio-primary"
        name={name}
        value="primary"
        defaultChecked={color === "primary"}
      />
      <input
        type="radio"
        className="radio radio-secondary"
        name={name}
        value="secondary"
        defaultChecked={color === "secondary"}
      />
      <input
        type="radio"
        className="radio radio-accent"
        name={name}
        value="accent"
        defaultChecked={color === "accent"}
      />
      <input
        type="radio"
        className="radio radio-info"
        name={name}
        value="info"
        defaultChecked={color === "info"}
      />
      <input
        type="radio"
        className="radio radio-success"
        name={name}
        value="success"
        defaultChecked={color === "success"}
      />
      <input
        type="radio"
        className="radio radio-warning"
        name={name}
        value="warning"
        defaultChecked={color === "warning"}
      />
      <input
        type="radio"
        className="radio radio-error"
        name={name}
        value="error"
        defaultChecked={color === "error"}
      />
    </label>
  );
}

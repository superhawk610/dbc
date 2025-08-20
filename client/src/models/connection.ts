export default interface Connection {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string | null;
  password_file: string | null;
  database: string;
  ssl: boolean;

  // client-side
  color?:
    | null
    | "primary"
    | "secondary"
    | "accent"
    | "info"
    | "success"
    | "warning"
    | "error";
}

export function connectionColorToClass(color: Connection["color"]) {
  switch (color) {
    case "primary":
      return "bg-primary text-primary-content focus:bg-primary focus:outline-primary";
    case "secondary":
      return "bg-secondary text-secondary-content focus:bg-secondary focus:outline-secondary";
    case "accent":
      return "bg-accent text-accent-content focus:bg-accent focus:outline-accent";
    case "info":
      return "bg-info text-info-content focus:bg-info focus:outline-info";
    case "success":
      return "bg-success text-success-content focus:bg-success focus:outline-success";
    case "warning":
      return "bg-warning text-warning-content focus:bg-warning focus:outline-warning";
    case "error":
      return "bg-error text-error-content focus:bg-error focus:outline-error";
    default:
      return "focus:outline-primary";
  }
}

export function loadConnectionColors() {
  const colors = globalThis.localStorage.getItem("connection-colors");
  return colors ? JSON.parse(colors) : {};
}

export function saveConnectionColors(colors: Record<string, string>) {
  globalThis.localStorage.setItem("connection-colors", JSON.stringify(colors));
}

import Connection from "./connection.ts";

export interface ConnectionStatus {
  connection: string;
  database: string;
  status: "active" | "pending" | "failed";
  message: string;
}

export default interface Config {
  connections: Connection[];
  status: ConnectionStatus[];
}

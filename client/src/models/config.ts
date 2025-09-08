import Connection from "./connection.ts";

export interface ConnectionStatus {
  connection: string;
  database: string;
  connected: boolean;
  status: string;
}

export default interface Config {
  connections: Connection[];
  status: ConnectionStatus[];
}

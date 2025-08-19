export default interface Connection {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string | null;
  password_file: string | null;
  database: string;
  ssl: boolean;
}

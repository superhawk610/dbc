export default interface Connection {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  password_file: string;
  database: string;
  ssl: boolean;
}

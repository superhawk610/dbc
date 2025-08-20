import { PaginatedQueryResult, Sort } from "./models/query.ts";

const baseUrl = `http://${import.meta.env.VITE_API_BASE}`;
const socketUrl = `ws://${import.meta.env.VITE_API_BASE}`;

const NO_CONTENT = 204;

export interface RequestOpts {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const req = (method: string) => {
  return async <T>(
    path: string,
    data?: object,
    opts?: RequestOpts,
  ): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      mode: "cors",
      method,
      headers: {
        ...(opts?.headers ?? {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
      signal: opts?.signal,
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    if (response.status === NO_CONTENT) {
      return null as T;
    }

    return response.json();
  };
};

export const rawDefaultQuery = <T>(connection: string, path: string) =>
  get<T>(path, undefined, { headers: { "x-conn-name": connection } });

export const rawQuery = <T>(
  connection: string,
  database: string,
  path: string,
) =>
  get<T>(path, undefined, {
    headers: { "x-conn-name": connection, "x-database": database },
  });

export const paginatedQuery = (
  connection: string,
  database: string,
  query: string,
  sort: Sort | null,
  page: number,
  pageSize: number,
) =>
  post<PaginatedQueryResult>("/query", {
    query,
    sort,
    page,
    page_size: pageSize,
  }, {
    headers: { "x-conn-name": connection, "x-database": database },
  });

export const get = req("GET");
export const post = req("POST");
export const put = req("PUT");
export const del = req("DELETE");
export const createSocket = (channel: string) =>
  new WebSocket(`${socketUrl}/${channel}`);

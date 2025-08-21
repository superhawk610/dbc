import { PaginatedQueryResult, Sort } from "./models/query.ts";

const baseUrl = `http://${import.meta.env.VITE_API_BASE}`;
const socketUrl = `ws://${import.meta.env.VITE_API_BASE}`;

const NO_CONTENT = 204;

const CACHE_TIMEOUT_SEC = 5 * 60;
const CACHE_PREFIX = "dbc-cache";
const cacheKey = (path: string, data?: object, opts?: RequestOpts) =>
  `${CACHE_PREFIX}:${path}:${JSON.stringify(data)}:${
    JSON.stringify(opts?.headers ?? {})
  }`;

export function clearNetworkCache() {
  // use a for loop instead of `Object.entries` to play nice with the shim
  for (let i = 0; i < globalThis.localStorage.length; i++) {
    const key = globalThis.localStorage.key(i);
    if (key!.startsWith(CACHE_PREFIX)) {
      globalThis.localStorage.removeItem(key!);
    }
  }
}

export interface RequestOpts {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  // How long to cache the resopnse, in seconds.
  // If not specified or set to -1, the response will not be cached.
  cacheTimeoutSec?: number;
}

const req = (method: string) => {
  return async <T>(
    path: string,
    data?: object,
    opts?: RequestOpts,
  ): Promise<T> => {
    const cacheTimeoutSec = opts?.cacheTimeoutSec ?? -1;
    const shouldCache = cacheTimeoutSec > 0;
    const key = cacheKey(path, data, opts);

    // try to use a cached response, if available
    if (shouldCache) {
      const cached = globalThis.localStorage.getItem(key);
      if (cached) {
        try {
          const { data, expiresAt } = JSON.parse(cached);
          if (Date.now() < expiresAt) {
            console.debug("Using cached response for", path);
            return data;
          } else {
            console.debug("Removing expired cache for", path);
            globalThis.localStorage.removeItem(key);
          }
        } catch {
          console.error("Failed to parse cached response for", path);
        }
      }
    }

    // if not cached, make the request
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

    let res: T;
    if (response.status === NO_CONTENT) {
      res = null as T;
    } else {
      res = await response.json();
    }

    // cache the response, if caching is enabled
    if (cacheTimeoutSec > 0) {
      globalThis.localStorage.setItem(
        key,
        JSON.stringify({
          data: res,
          expiresAt: Date.now() + cacheTimeoutSec * 1000,
        }),
      );
    }

    return res;
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

export interface PaginatedQueryRequest {
  query: string;
  sort: Sort | null;
  page: number;
  pageSize: number;
  useCache: boolean;
}

export const paginatedQuery = (
  connection: string,
  database: string,
  req: PaginatedQueryRequest,
) =>
  post<PaginatedQueryResult>("/query", {
    query: req.query,
    sort: req.sort,
    page: req.page,
    page_size: req.pageSize,
  }, {
    cacheTimeoutSec: req.useCache ? CACHE_TIMEOUT_SEC : -1,
    headers: { "x-conn-name": connection, "x-database": database },
  });

export const get = req("GET");
export const post = req("POST");
export const put = req("PUT");
export const del = req("DELETE");
export const createSocket = (channel: string) =>
  new WebSocket(`${socketUrl}/${channel}`);

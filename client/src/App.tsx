import { useEffect, useRef, useState } from "react";
import {
  HiDocumentAdd as NewTabIcon,
  HiDownload as DownloadIcon,
  HiOutlineDatabase as DatabaseIcon,
  HiOutlineServer as LeftPanelIcon,
  HiViewList as ListIcon,
} from "react-icons/hi";
import {
  clearNetworkCache,
  get,
  NetworkError,
  paginatedQuery,
  prepareQuery,
  rawDefaultQuery,
  rawQuery,
} from "./api.ts";

import useResize from "./hooks/useResize.ts";
import Navbar from "./components/Navbar.tsx";
import Editor, { EditorRef } from "./components/Editor.tsx";
import ConnectionSelect from "./components/editor/ConnectionSelect.tsx";
import DatabaseSelect from "./components/editor/DatabaseSelect.tsx";
import SchemaSelect, {
  getLastSchema,
} from "./components/editor/SchemaSelect.tsx";
import QueryResults, {
  stringifyValue,
} from "./components/results/QueryResults.tsx";
import Pagination from "./components/Pagination.tsx";
import Config from "./models/config.ts";
import Connection from "./models/connection.ts";
import {
  Filter,
  PaginatedQueryResult,
  PaginatedSelectQueryResult,
  QueryParam,
  Sort,
} from "./models/query.ts";
import Database from "./models/database.ts";
import Schema from "./models/schema.ts";
import Table from "./models/table.ts";
import SettingsModal from "./components/SettingsModal.tsx";
import ParamModal from "./components/ParamModal.tsx";
import useConnectionVersion from "./hooks/useConnectionVersion.ts";
import Field from "./components/form/Field.tsx";
import TablesPanel from "./components/tables/TablesPanel.tsx";
import Alerts, { AlertsRef } from "./components/Alerts.tsx";

const EDITOR_HEIGHT = { min: 100, default: 400 };

const ABORT_USER_CANCEL = "USER_CANCEL";

interface LastQuery {
  connection: string | null | undefined;
  query: string;
  sort: Sort | null;
  page: number;
  pageSize: number;
  params: string[];
  filters: Filter[];
  offset: number | undefined;
  abort: AbortController;
}

// tell React to re-render the results panel whenever any of these changes,
// so we don't accidentally persist a row from a previous query with the same index
const resultsKey = (query: LastQuery) =>
  `${query.query}-${query.page}-${query.pageSize}-${query.sort}`;

function csvEscape(str: string) {
  if (['"', ",", "\n"].some((c) => str.includes(c))) {
    return `"${str.replaceAll('"', '""')}"`;
  }

  return str;
}

function App() {
  const editorRef = useRef<EditorRef>(null);
  const alertsRef = useRef<AlertsRef>(null);

  const [showResults, setShowResults] = useState(false);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [settingsModalActive, setSettingsModalsActive] = useState(false);
  const [paramModalActive, setParamModalActive] = useState(false);
  const [queryParams, setQueryParams] = useState<QueryParam[]>([]);

  const [res, setRes] = useState<PaginatedQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [useCache, setUseCache] = useState(true);

  const [tablesLoading, setTablesLoading] = useState(false);
  const [uiLoading, setUiLoading] = useState(false);

  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [databases, setDatabases] = useState<Database[] | null>(null);
  const [database, setDatabase] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<Schema[] | null>(null);
  const [schema, setSchema] = useState<string | null>(null);
  const [tables, setTables] = useState<Table[] | null>(null);

  // TODO: prefetch more than the current page
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filters, setFilters] = useState<Filter[]>([]);
  const queryRef = useRef({ filters } as LastQuery);

  const resultsResizeRef = useRef<HTMLDivElement>(null);
  const resultsResizeHandleRef = useRef<HTMLDivElement>(null);
  useResize({
    active: showResults,
    dimension: "height",
    resizeRef: resultsResizeRef,
    resizeHandleRef: resultsResizeHandleRef,
    sizes: {
      minimum: EDITOR_HEIGHT.min,
      default: EDITOR_HEIGHT.default,
    },
  });

  const leftPanelResizeRef = useRef<HTMLDivElement>(null);
  const leftPanelResizeHandleRef = useRef<HTMLDivElement>(null);
  useResize({
    active: showLeftPanel,
    dimension: "width",
    resizeRef: leftPanelResizeRef,
    resizeHandleRef: leftPanelResizeHandleRef,
    sizes: { minimum: 200, default: 360 },
  });

  const version = useConnectionVersion(connection?.name);

  useEffect(() => {
    globalThis.__wryContext__.handlers.openSettings = () => {
      setSettingsModalsActive(true);
    };
    globalThis.__wryContext__.handlers.newTab = () => {
      openNewTab();
    };
    globalThis.__wryContext__.handlers.toggleResults = () => {
      setShowResults((x) => !x);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        setUiLoading(true);

        const config = await get<Config>("/config");
        setConnections(config.connections);

        // select first available connection by default
        if (config.connections.length > 0) {
          setConnection(config.connections[0]);
        } else {
          setSettingsModalsActive(true);
        }
      } catch (err) {
        setError((err as Error).message);
        setShowResults(true);
      } finally {
        setUiLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!connection) return;

    (async () => {
      try {
        setError(null);
        setTables(null);
        setUiLoading(true);

        const databases = await rawDefaultQuery<Database[]>(
          connection.name,
          "/db/databases",
        );
        setDatabases(databases);

        // select configured database by default, or `postgres` if none configured,
        // or finally the first available if neither of those are available
        if (databases.length > 0) {
          setDatabase(
            databases.find((d) => d.datname === connection.database)?.datname ||
              databases.find((d) => d.datname === "postgres")?.datname ||
              databases[0].datname,
          );
        }
      } catch (err) {
        setError((err as Error).message);
        setShowResults(true);
      } finally {
        setUiLoading(false);
      }
    })();
  }, [connection]);

  useEffect(() => {
    if (!connection || !database) return;

    (async () => {
      try {
        setError(null);
        setUiLoading(true);

        const schemas = await rawQuery<Schema[]>(
          connection.name,
          database,
          "/db/schemas",
        );
        setSchemas(schemas);

        // select last used schema by default, or try the `public` schema (as that's usually
        // the default), or finally the first available if neither of those are available
        if (schemas.length > 0) {
          setSchema(
            getLastSchema(connection.name, database) ||
              schemas.find((s) => s.schema_name === "public")?.schema_name ||
              schemas[0].schema_name,
          );
        }
      } catch (err) {
        setError((err as Error).message);
        setShowResults(true);
      } finally {
        setUiLoading(false);
      }
    })();
  }, [connection, database]);

  useEffect(() => {
    if (!connection || !database || !schema) return;

    (async () => {
      try {
        setError(null);
        setTablesLoading(true);

        const tables = await rawQuery<Table[]>(
          connection.name,
          database,
          `/db/schemas/${schema}/tables`,
        );
        setTables(tables);
      } catch (err) {
        setError((err as Error).message);
        setShowResults(true);
      } finally {
        setTablesLoading(false);
      }
    })();
  }, [connection, database, schema]);

  useEffect(() => {
    // if there's no query, do nothing
    if (!queryRef.current.query) return;

    dispatchQuery(queryRef.current.query, sort, page, pageSize);
  }, [sort, page, pageSize]);

  function submitQuery(withQuery?: string) {
    // store the query in local storage to be restored on page reload
    editorRef.current!.saveTabs();

    // if the query hasn't changed, just show results
    let query: string;
    let offset: number | undefined = undefined;
    if (withQuery) {
      query = withQuery;
    } else {
      const activeQuery = editorRef.current!.getActiveQuery();
      if (activeQuery) {
        query = activeQuery.query;
        offset = activeQuery.offset;
      } else {
        query = editorRef.current!.getContents();
      }
    }

    if (queryRef.current.query === query) {
      setShowResults(true);
    }

    // reset to the first page and unsorted/unfiltered results on submit
    setPage(1);
    setSort(null);
    setFilters([]);
    queryRef.current.filters = [];
    const prevParams = queryRef.current.params || [];
    queryRef.current.params = [];
    dispatchQuery(
      query,
      null,
      1,
      pageSize,
      !useCache || prevParams.length > 0,
      offset,
    );
  }

  function handleParamSubmit(params: string[]) {
    setParamModalActive(false);
    queryRef.current.params = params;
    dispatchQuery(
      queryRef.current.query,
      queryRef.current.sort,
      queryRef.current.page,
      queryRef.current.pageSize,
      true,
      queryRef.current.offset,
    );
  }

  async function dispatchQuery(
    query: string,
    sort: Sort | null,
    page: number,
    pageSize: number,
    force?: boolean,
    offset?: number,
  ) {
    // if nothing has changed, do nothing
    if (
      !force &&
      queryRef.current.query === query &&
      queryRef.current.sort === sort &&
      queryRef.current.page === page &&
      queryRef.current.pageSize === pageSize
    ) {
      return;
    }

    // if the query has changed, clear the results
    if (force || queryRef.current.query !== query) {
      setRes(null);
    }

    queryRef.current.query = query;
    queryRef.current.sort = sort;
    queryRef.current.page = page;
    queryRef.current.pageSize = pageSize;
    queryRef.current.offset = offset;

    const abort = new AbortController();

    try {
      setError(null);
      setLoading(true);

      let params: string[] = [];
      if (queryRef.current.params && queryRef.current.params.length > 0) {
        params = queryRef.current.params;
      } else {
        const prepareRes = await prepareQuery(
          connection!.name,
          database!,
          query,
        );
        if (prepareRes.params.length > 0) {
          setShowResults(false);
          setQueryParams(prepareRes.params);
          setParamModalActive(true);
          return;
        }
      }

      // show results pane
      setShowResults(true);

      // clear any previously set errors
      editorRef.current!.clearErrors();

      queryRef.current.abort = abort;

      const res = await paginatedQuery(
        connection!.name,
        database!,
        {
          query,
          params,
          sort,
          page,
          pageSize,
          filters: queryRef.current.filters,
          useCache,
          signal: abort.signal,
        },
      );

      setRes(res);

      // if the statement modified structure, clear the network cache and refresh tables
      switch (res.type) {
        case "modify-structure": {
          clearNetworkCache();

          const tables = await rawQuery<Table[]>(
            connection!.name,
            database!,
            `/db/schemas/${schema}/tables`,
          );
          setTables(tables);

          break;
        }

        // if it modified data, just clear the network cache
        case "modify-data": {
          clearNetworkCache();
          break;
        }

        default:
          // do nothing
      }
    } catch (_err) {
      // if the query was cancelled, do nothing
      if (abort.signal.aborted) return;

      // reset the last query so that subsequent runs of the same query actually dispatch
      queryRef.current = { filters: [] } as unknown as LastQuery;

      const err = _err as NetworkError;

      setError(err.message);
      setShowResults(true);
      setRes(null);

      if (err.details && err.details.position !== null) {
        editorRef.current!.addError(
          err.message,
          err.details!.position as number,
          offset,
        );
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSave(updatedConnections: Connection[]) {
    setConnections(updatedConnections);

    // as long as the existing connection is still present, we're done
    if (updatedConnections.find((c) => c.name === connection?.name)) return;

    // if the existing connection no longer exists, default to the first
    setConnection(
      updatedConnections.length > 0 ? updatedConnections[0] : null,
    );
  }

  async function handleDownload() {
    setError(null);
    setUiLoading(true);

    try {
      const res = await paginatedQuery(
        connection!.name,
        database!,
        {
          query: queryRef.current.query,
          params: queryRef.current.params,
          sort: queryRef.current.sort,
          page: 1,
          pageSize: -1,
          filters: queryRef.current.filters,
          useCache: false,
        },
      );

      const entries = (res as PaginatedSelectQueryResult).entries;

      const headerRow = entries.columns.map((col) => csvEscape(col.name)) +
        "\n";

      const rows = entries.rows.map((row) => {
        return row.map((val) => csvEscape(stringifyValue(val))).join(",") +
          "\n";
      });

      const blob = new Blob([headerRow].concat(rows), { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `query-${Date.now()}.csv`;
      a.click();

      alertsRef.current?.addAlert({
        style: "success",
        message: `Downloading to ${a.download}`,
      });

      URL.revokeObjectURL(url);
    } catch (_err) {
      const err = _err as NetworkError;
      setError(err.message);
    } finally {
      setUiLoading(false);
    }
  }

  function openNewTab() {
    editorRef.current!.openTab({
      id: `dbc://query/${Date.now()}`,
      name: (n: number) => `Query / Script ${n + 1}`,
      language: "sql",
      contents: "",
    });
  }

  return (
    <div className="flex flex-col items-stretch w-screen h-screen">
      <Navbar onSaveSettings={handleSave}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={openNewTab}
        >
          <NewTabIcon /> New Tab
        </button>
      </Navbar>

      <Alerts ref={alertsRef} />

      <div
        ref={resultsResizeRef}
        className={`flex flex-col ${showResults ? "" : "flex-grow-1"}`}
      >
        <Editor
          ref={editorRef}
          connection={connection?.name}
          database={database}
          schema={schema}
          onClick={() => submitQuery()}
          onClickLabel="Query ⌘⏎"
          hideSidebar={!showLeftPanel}
          sidebar={
            <div
              ref={leftPanelResizeRef}
              className="relative flex flex-col pr-1"
            >
              <div
                ref={leftPanelResizeHandleRef}
                className="absolute top-0 right-0 bg-base-100 h-full w-1 cursor-ew-resize z-10
                transition-colors hover:delay-150 hover:bg-primary hover:ring-primary hover:ring-0.5"
              />

              <TablesPanel
                connection={connection?.name ?? null}
                database={database}
                tables={tables ?? []}
                loading={tablesLoading}
                onInsertName={(name) => {
                  // insert text into editor at current cursor position
                  editorRef.current!.insert(name);
                  editorRef.current!.focus();
                }}
                onQueryAll={(name) => {
                  const query = `SELECT * FROM "${name}";`;

                  editorRef.current!.openTab({
                    id: `dbc://query/${Date.now()}`,
                    name: `Query / Table ${name}`,
                    language: "sql",
                    contents: query,
                    icon: "cube",
                  });

                  submitQuery(query);
                }}
                onQuery={(name) => {
                  const query = `SELECT * FROM "${name}" LIMIT 100;`;

                  editorRef.current!.openTab({
                    id: `dbc://query/${Date.now()}`,
                    name: `Query / Table ${name}`,
                    language: "sql",
                    contents: query,
                    icon: "cube",
                  });

                  submitQuery(query);
                }}
                onViewDefinition={async (table) => {
                  const res = await get<{ ddl: string }>(
                    `/db/ddl/schemas/${schema}/${table.type}/${table.table_name}`,
                    undefined,
                    {
                      headers: {
                        "x-conn-name": connection!.name,
                        "x-database": database!,
                      },
                    },
                  );

                  // open new editor tab
                  editorRef.current!.openTab({
                    id: `dbc://table/${table.table_name}`,
                    name: `${
                      table.type === "table" ? "Table" : "View"
                    } / ${table.table_name}`,
                    language: "sql",
                    contents: res.ddl,
                    icon: "database",
                  });
                }}
              />
            </div>
          }
          toolbar={
            <>
              {connections && connections.length > 0 && (
                <ConnectionSelect
                  connections={connections}
                  selected={connection?.name}
                  onSelect={(name) => {
                    setConnection(connections.find((c) => c.name === name)!);

                    // reset database/schema when connection changes
                    setDatabases(null);
                    setDatabase(null);
                    setSchemas(null);
                    setSchema(null);
                  }}
                  onManageConnections={() => setSettingsModalsActive(true)}
                />
              )}
              {databases && (
                <DatabaseSelect
                  databases={databases}
                  selected={database}
                  onSelect={setDatabase}
                />
              )}
              {schemas && (
                <SchemaSelect
                  connection={connection?.name}
                  database={database}
                  schemas={schemas}
                  selected={schema}
                  onSelect={setSchema}
                />
              )}
              <div
                className="-ml-2"
                title="Cache query responses to reduce response delay."
              >
                <Field
                  size="xs"
                  name="useCache"
                  type="checkbox"
                  label="use cache"
                  defaultChecked={useCache}
                  onChange={(ev) => setUseCache(ev.target.checked)}
                />
              </div>
            </>
          }
        />
      </div>

      <SettingsModal
        active={settingsModalActive}
        onClose={() => setSettingsModalsActive(false)}
        onSave={handleSave}
      />

      <ParamModal
        params={queryParams}
        active={paramModalActive}
        onClose={() => {
          // reset query ref so that subsequent queries ignore the in-progress param fetch
          queryRef.current = { filters: [] } as unknown as LastQuery;
          setParamModalActive(false);
        }}
        onSubmit={handleParamSubmit}
      />

      {showResults && (
        <div className="flex-1 flex flex-col bg-base-300 overflow-y-auto">
          <div
            ref={resultsResizeHandleRef}
            className="bg-base-200 h-1 cursor-ns-resize z-10
            transition-colors hover:delay-150 hover:bg-primary hover:ring-primary hover:ring-0.5"
          />

          <QueryResults
            key={resultsKey(queryRef.current)}
            page={res}
            filters={filters}
            error={error}
            loading={loading}
            onCancel={() => {
              queryRef.current.abort.abort(ABORT_USER_CANCEL);
              setError("Query cancelled by user");
              setLoading(false);
            }}
            onToggleSort={(column_idx, direction) =>
              setSort(direction ? { column_idx, direction } : null)}
            onFilterChange={(filters) => setFilters(filters)}
            onFilterApply={(filters) => {
              // only update filters and dispatch query when explicitly requested;
              // don't do anything in a `useEffect` when `filters` changes, because
              // that happens every time the user types
              queryRef.current.filters = filters;

              dispatchQuery(
                queryRef.current.query,
                sort,
                page,
                pageSize,
                true,
              );
            }}
            onForeignKeyClick={(column, value) => {
              const query =
                `SELECT * FROM ${column.fk_table} WHERE ${column.fk_column} = ${
                  JSON.stringify(value)
                };`;

              editorRef.current!.openTab({
                id: `dbc://query/${Date.now()}`,
                name: (n: number) => `Query / Script ${n + 1}`,
                language: "sql",
                contents: query,
                icon: "database",
              });

              // open new tab and submit query
              submitQuery(query);
            }}
            onViewValueClick={(value) => {
              editorRef.current!.openTab({
                id: `dbc://cell/${Date.now()}`,
                name: "Cell / Value",
                language: "text",
                contents: (Array.isArray(value) || typeof value === "object")
                  ? JSON.stringify(value, null, 2)
                  : value!.toString(),
                icon: "cube",
              });
            }}
          />
        </div>
      )}

      <div
        data-wry-drag-region
        className="h-[42px] flex items-center gap-2 px-4 py-2 text-sm"
      >
        <div className="flex gap-0.5">
          <button
            type="button"
            title="Toggle table view"
            className={`btn btn-ghost btn-xs px-1 rounded-sm ${
              showLeftPanel ? "" : "opacity-30"
            }`}
            onClick={() => setShowLeftPanel((x) => !x)}
          >
            <LeftPanelIcon className="w-4 h-4" />
          </button>

          <button
            type="button"
            title="Toggle query results"
            className={`btn btn-ghost btn-xs px-1 rounded-sm ${
              showResults ? "" : "opacity-30"
            }`}
            onClick={() => setShowResults((x) => !x)}
          >
            <ListIcon className="w-4 h-4" />
          </button>
        </div>

        {showResults && res && res.type === "select" && res.total_count > 0 && (
          <div className="flex items-center gap-2 flex-1">
            <button
              type="button"
              title="Download query results"
              className="-ml-1.5 btn btn-ghost btn-xs px-1 rounded-sm"
              onClick={() => handleDownload()}
            >
              <DownloadIcon className="w-4 h-4" />
            </button>

            <Pagination
              query={res}
              page={page}
              setPage={setPage}
              pageSize={pageSize}
              loading={loading}
              setPageSize={(newPageSize) => {
                setPageSize(newPageSize);
                setPage(1);
              }}
            />
          </div>
        )}

        <div className="flex gap-2 pl-2 items-center ml-auto">
          {version && (
            <div className="badge badge-xs badge-outline badge-success flex items-center select-none">
              <div className="h-1.5 w-1.5 rounded-full bg-success" />
              {version}
            </div>
          )}

          {uiLoading && (
            <div className="opacity-50 loading loading-infinity loading-sm" />
          )}

          <div className={version ? "text-success" : "opacity-50"}>
            <DatabaseIcon />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

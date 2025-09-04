import { useEffect, useRef, useState } from "react";
import {
  HiDocumentAdd as NewTabIcon,
  HiOutlineDatabase as DatabaseIcon,
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
import QueryResults from "./components/results/QueryResults.tsx";
import Pagination from "./components/Pagination.tsx";
import Config from "./models/config.ts";
import Connection from "./models/connection.ts";
import { Filter, PaginatedQueryResult, Sort } from "./models/query.ts";
import Database from "./models/database.ts";
import Schema from "./models/schema.ts";
import Table from "./models/table.ts";
import SettingsModal from "./components/SettingsModal.tsx";
import useConnectionVersion from "./hooks/useConnectionVersion.ts";
import Field from "./components/form/Field.tsx";
import SearchableList from "./components/SearchableList.tsx";

const EDITOR_HEIGHT = { min: 100, default: 400 };

const ABORT_USER_CANCEL = "USER_CANCEL";

interface LastQuery {
  connection: string | null | undefined;
  query: string;
  sort: Sort | null;
  page: number;
  pageSize: number;
  filters: Filter[];
  abort: AbortController;
}

// tell React to re-render the results panel whenever any of these changes,
// so we don't accidentally persist a row from a previous query with the same index
const resultsKey = (query: LastQuery) =>
  `${query.query}-${query.page}-${query.pageSize}-${query.sort}`;

function App() {
  const editorRef = useRef<EditorRef>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const [showResults, setShowResults] = useState(false);
  const [settingsModalActive, setSettingsModalsActive] = useState(false);

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

  useResize({
    active: showResults,
    resizeRef,
    resizeHandleRef,
    minHeight: EDITOR_HEIGHT.min,
    defaultHeight: EDITOR_HEIGHT.default,
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
        }
      } catch (err) {
        setError((err as Error).message);
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
    dispatchQuery(query, null, 1, pageSize, !useCache, offset);
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

    // show results pane
    setShowResults(true);

    // clear any previously set errors
    editorRef.current!.clearErrors();

    const abort = new AbortController();
    queryRef.current.abort = abort;

    try {
      setError(null);
      setLoading(true);

      // FIXME: improved modal for parameter input (globalThis.prompt doesn't work in wry)
      const prepareRes = await prepareQuery(connection!.name, database!, query);
      const params: string[] = [];
      for (const param of prepareRes.params) {
        params.push(prompt(`${param.name} (${param.type})`) || "");
      }

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
          console.log(tables);

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

      const err = _err as NetworkError;

      setError(err.message);
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
        <button
          type="button"
          className={`btn btn-sm ${showResults && "btn-primary"}`}
          onClick={() => setShowResults(!showResults)}
        >
          <ListIcon /> Results
        </button>
      </Navbar>

      <div
        ref={resizeRef}
        className={`flex flex-col ${showResults ? "" : "flex-grow-1"}`}
      >
        <Editor
          ref={editorRef}
          connection={connection?.name}
          database={database}
          schema={schema}
          onClick={() => submitQuery()}
          onClickLabel="Query ⌘⏎"
          sidebar={
            <div className="w-[300px] flex flex-col">
              <SearchableList
                loading={tablesLoading}
                items={tables?.map((t) => ({
                  text: t.table_name,
                  icon: t.type,
                })) ?? []}
                onClick={async (table_name) => {
                  const table = tables?.find((t) =>
                    t.table_name === table_name
                  )!;

                  const res = await get<{ ddl: string }>(
                    `/db/ddl/schemas/${schema}/${table.type}/${table_name}`,
                    undefined,
                    {
                      headers: {
                        "x-conn-name": connection!.name,
                        "x-database": database!,
                      },
                    },
                  );

                  // insert text into editor
                  // editorRef.current!.insert(row[2]);
                  // editorRef.current!.focus();

                  // open new editor tab
                  editorRef.current!.openTab({
                    id: `dbc://table/${table_name}`,
                    name: `${
                      table.type === "table" ? "Table" : "View"
                    } / ${table_name}`,
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
              {connections && (
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

      {showResults && (
        <div className="flex-1 flex flex-col bg-base-300 overflow-y-auto">
          <div
            ref={resizeHandleRef}
            className="bg-base-200 h-1 cursor-ns-resize z-10"
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
                contents: value!.toString(),
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
        {showResults && res && res.type === "select" && res.total_count > 0 && (
          <div className="flex-1">
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

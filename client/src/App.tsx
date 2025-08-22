import { useEffect, useRef, useState } from "react";
import {
  HiDocumentAdd as NewTabIcon,
  HiViewList as ListIcon,
} from "react-icons/hi";
import {
  clearNetworkCache,
  get,
  paginatedQuery,
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
import QueryResults from "./components/QueryResults.tsx";
import Pagination from "./components/Pagination.tsx";
import Config from "./models/config.ts";
import Connection from "./models/connection.ts";
import { PaginatedQueryResult, Sort } from "./models/query.ts";
import Database from "./models/database.ts";
import Schema from "./models/schema.ts";
import Table from "./models/table.ts";
import SettingsModal from "./components/SettingsModal.tsx";
import useConnectionVersion from "./hooks/useConnectionVersion.ts";
import Field from "./components/form/Field.tsx";
import SearchableList from "./components/SearchableList.tsx";

const EDITOR_HEIGHT = { min: 100, default: 400 };

interface LastQuery {
  connection: string | null | undefined;
  query: string;
  sort: Sort | null;
  page: number;
  pageSize: number;
}

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
  const queryRef = useRef({} as LastQuery);

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
        setLoading(true);

        const config = await get<Config>("/config");
        setConnections(config.connections);

        // select first available connection by default
        if (config.connections.length > 0) {
          setConnection(config.connections[0]);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!connection) return;

    (async () => {
      try {
        setError(null);
        setLoading(true);

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
        setLoading(false);
      }
    })();
  }, [connection]);

  useEffect(() => {
    if (!connection || !database) return;

    (async () => {
      try {
        setError(null);
        setLoading(true);

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
        setLoading(false);
      }
    })();
  }, [connection, database]);

  useEffect(() => {
    if (!connection || !database || !schema) return;

    (async () => {
      try {
        setError(null);
        setLoading(true);

        const tables = await rawQuery<Table[]>(
          connection.name,
          database,
          `/db/schemas/${schema}/tables`,
        );
        setTables(tables);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [connection, database, schema]);

  useEffect(() => {
    // if there's no query, do nothing
    if (!queryRef.current.query) return;

    dispatchQuery(queryRef.current.query, sort, page, pageSize);
  }, [sort, page, pageSize]);

  function submitQuery(withQuery?: string) {
    const contents = editorRef.current!.getContents();

    // store the query in local storage to be restored on page reload
    editorRef.current!.saveTabs();

    // if the query hasn't changed, just show results
    const query = withQuery || editorRef.current!.getActiveQuery() || contents;
    if (queryRef.current.query === query) {
      setShowResults(true);
    }

    // reset to the first page and unsorted results on submit
    setPage(1);
    setSort(null);
    dispatchQuery(query, null, 1, pageSize, !useCache);
  }

  async function dispatchQuery(
    query: string,
    sort: Sort | null,
    page: number,
    pageSize: number,
    force?: boolean,
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

    queryRef.current.query = query;
    queryRef.current.sort = sort;
    queryRef.current.page = page;
    queryRef.current.pageSize = pageSize;

    // show results pane
    setShowResults(true);

    // clear any previously set errors
    editorRef.current!.clearErrors();

    try {
      setError(null);
      setLoading(true);

      const res = await paginatedQuery(
        connection!.name,
        database!,
        {
          query,
          sort,
          page,
          pageSize,
          useCache,
        },
      );

      setRes(res);

      // if the statement contained DDL, refresh the table view
      // and clear the network cache
      if (res.entries.is_ddl) {
        clearNetworkCache();

        const tables = await rawQuery<Table[]>(
          connection!.name,
          database!,
          `/db/schemas/${schema}/tables`,
        );
        setTables(tables);
      }
    } catch (err) {
      const message = (err as Error).message;

      setError(message);
      setRes(null);

      // FIXME: provided structured query error instead of using regex parsing
      // FIXME: errorPos should be relative to active query at time of dispatch
      const regex = /\(at position (\d+)\)/.exec(message);
      if (regex) {
        const errorPos = Number(regex[1]);
        editorRef.current!.addError(message, errorPos);
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
                loading={loading}
                items={tables?.map((t) => t.table_name) ?? []}
                onClick={async (table_name) => {
                  const res = await get<{ ddl: string }>(
                    `/db/ddl/schemas/${schema}/tables/${table_name}`,
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
                    name: `Table / ${table_name}`,
                    language: "sql",
                    contents: res.ddl,
                    icon: "database",
                  });
                }}
              />

              {version && (
                <div className="px-4 py-2 bg-neutral/10">
                  <div className="badge badge-xs badge-primary flex items-center select-none">
                    Connected: {version}
                  </div>
                </div>
              )}
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
                    setDatabase(null);
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
            className="bg-base-content/10 h-1 cursor-ns-resize z-[10]"
          />

          <QueryResults
            page={res}
            error={error}
            loading={loading}
            onToggleSort={(column_idx, direction) =>
              setSort({ column_idx, direction })}
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
          />

          {res && res.total_count > 0 && (
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
          )}
        </div>
      )}
    </div>
  );
}

export default App;

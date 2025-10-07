use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_with::{DeserializeFromStr, SerializeDisplay};
use std::collections::{HashMap, HashSet};
use time::macros::format_description;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::oneshot::{Receiver, Sender, channel};
use tokio_postgres::{Socket, types::ToSql};

pub type SqlParam<'a> = &'a (dyn ToSql + Sync);

#[derive(Debug, bon::Builder)]
pub struct Config {
    pub username: String,
    pub password: String,
    #[builder(default = "localhost".to_owned())]
    pub host: String,
    #[builder(default = 5432)]
    pub port: usize,
    pub database: String,
    #[builder(default)]
    pub ssl: bool,
    #[builder(default = 5)]
    pub pool_size: usize,
    /// How long to wait (in seconds) when checking out a connection.
    #[builder(default = 30)]
    pub pool_timeout_s: u64,
    /// How long to wait (in seconds) with no activity before closing all open connections.
    #[builder(default = 30 * 60)]
    pub idle_timeout_s: u64,
}

impl Config {
    pub fn conn_str(&self) -> String {
        format!(
            "postgres://{username}:{password}@{host}:{port}/{database}",
            username = self.username,
            password = self.password,
            host = self.host,
            port = self.port,
            database = self.database
        )
    }
}

pub fn spawn_conn<T>(conn: tokio_postgres::Connection<Socket, T>, tx: Sender<()>, rx: Receiver<()>)
where
    T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        tokio::select! {
            // the connection will never resolve to `Ok()`; if an error is
            // encountered, it will resolve to `Err()`
            Err(e) = conn => {
                tracing::error!("connection error: {}", e);
            }

            // if a kill signal is received instead, terminate the connection
            _ = rx => {}
        }

        // fire one-shot to close channel and terminate async task
        let _ = tx.send(());
    });
}

pub struct Client {
    inner: tokio_postgres::Client,

    /// The materialized view query. Postgres doesn't have an `information_schema.materialized_views`
    /// table, so we need to fetch it manually. This can be done by slightly modifying the query that
    /// backs `information_schema.views`. This should only be done once during the first connection.
    mat_view_query: String,
}

impl std::ops::Deref for Client {
    type Target = tokio_postgres::Client;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl Client {
    pub async fn new(inner: tokio_postgres::Client) -> eyre::Result<Self> {
        // FIXME: this doesn't work on unprivileged databases that won't allow you to query
        // the definition of the `views` view, ugh. probably need to just hard-code it here
        // let mat_view_query = inner
        //     .query_one(
        //         "select view_definition
        //         from information_schema.views
        //         where table_schema = 'information_schema'
        //         and table_name = 'views'",
        //         &[],
        //     )
        //     .await
        //     .map_err(PgError::from)
        //     .map(|row| row.get::<_, String>(0))
        //     .unwrap()
        //     // by default, this view selects views; we want materialized views instead
        //     .replace("c.relkind = 'v'", "c.relkind = 'm'")
        //     .trim_end_matches(';')
        //     .to_owned();

        Ok(Self {
            inner,
            mat_view_query: "".to_owned(),
        })
    }
}

pub struct Connection {
    client: Client,
    tx: Option<Sender<()>>,
    rx: Option<Receiver<()>>,
}

impl std::ops::Deref for Connection {
    type Target = Client;

    fn deref(&self) -> &Self::Target {
        &self.client
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.kill();
    }
}

impl Connection {
    /// Checks whether a connection is still live.
    ///
    /// If the connection's async task is still running, the sender
    /// side of the one-shot channel will still be live. Once the
    /// task terminates (either due to a connection error or a manual
    /// kill), the task will terminate and the connection will no longer
    /// be live.
    pub fn is_live(&mut self) -> bool {
        self.rx.take_if(|rx| rx.try_recv().is_ok()).is_some()
    }

    /// Kill the connection if it's still alive.
    ///
    /// Calling this method multiple times is safe; any call after the
    /// first will have no effect.
    pub fn kill(&mut self) {
        if let Some(tx) = self.tx.take() {
            let _ = tx.send(());
        }
    }
}

pub async fn connect(config: &Config) -> eyre::Result<Connection> {
    let (live_tx, live_rx) = channel();
    let (kill_tx, kill_rx) = channel();

    let client = if config.ssl {
        let tls = MakeTlsConnector::new(TlsConnector::new()?);
        let (client, conn) = tokio_postgres::connect(&config.conn_str(), tls).await?;

        spawn_conn(conn, live_tx, kill_rx);

        client
    } else {
        let (client, conn) =
            tokio_postgres::connect(&config.conn_str(), tokio_postgres::NoTls).await?;

        spawn_conn(conn, live_tx, kill_rx);

        client
    };

    Ok(Connection {
        client: Client::new(client).await?,
        rx: Some(live_rx),
        tx: Some(kill_tx),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterOp {
    Eq,
    Neq,
    Like,
    NotLike,
    Null,
    NotNull,
    Gt,
    Gte,
    Lt,
    Lte,
}

#[derive(Debug, Deserialize)]
pub struct Filter {
    pub index: usize,
    pub column: String,
    pub operator: FilterOp,
    pub value: serde_json::Value,
}

impl Filter {
    pub fn where_clause(&self, param_idx: usize) -> (bool, String) {
        match (self.uses_param(), &self.operator) {
            (true, FilterOp::Like | FilterOp::NotLike) => (
                true,
                format!(
                    "{} {} CONCAT('%', ${}::text, '%')",
                    Self::col_name(self.index, &self.column),
                    self.sql_op(),
                    param_idx + 1
                ),
            ),
            (true, _) => (
                true,
                format!(
                    "{} {} ${}",
                    Self::col_name(self.index, &self.column),
                    self.sql_op(),
                    param_idx + 1
                ),
            ),
            (false, _) => (
                false,
                format!(
                    "{} {}",
                    Self::col_name(self.index, &self.column),
                    self.sql_op()
                ),
            ),
        }
    }

    pub fn col_name(col_idx: usize, col_name: &str) -> String {
        format!("\"{}.{}\"", col_idx, col_name.replace('"', "\"\""))
    }

    fn sql_op(&self) -> &'static str {
        match self.operator {
            FilterOp::Eq => "=",
            FilterOp::Neq => "!=",
            FilterOp::Like => "ILIKE",
            FilterOp::NotLike => "NOT ILIKE",
            FilterOp::Null => "IS NULL",
            FilterOp::NotNull => "IS NOT NULL",
            FilterOp::Gt => ">",
            FilterOp::Gte => ">=",
            FilterOp::Lt => "<",
            FilterOp::Lte => "<=",
        }
    }

    pub fn uses_param(&self) -> bool {
        match self.operator {
            FilterOp::Null | FilterOp::NotNull => false,
            _ => true,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<QueryResultColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum PaginatedQueryResult {
    Select {
        /// 1-indexed page number.
        page: usize,
        /// The number of rows included in a single page.
        /// If negative, all available rows are included.
        page_size: isize,
        /// The number of rows contained in the current page.
        page_count: usize,
        /// The total number of rows available across all pages.
        total_count: usize,
        /// The total number of pages.
        total_pages: usize,
        /// The sort order used to generate this page. The sort `column_idx` can
        /// be used to index into the `QueryResult`'s `columns` array to get the
        /// column name.
        sort: Option<Sort>,
        /// The current page.
        entries: QueryResult,
    },

    ModifyData {
        /// How many rows were updated/deleted.
        affected_rows: u64,
    },

    ModifyStructure,

    Explain {
        /// The query that was executed.
        query: String,
        /// The query execution plan.
        plan: String,
    },
}

pub type QueryRows = Vec<HashMap<String, serde_json::Value>>;

impl QueryResult {
    pub fn row_maps(&self) -> Vec<HashMap<String, serde_json::Value>> {
        self.rows
            .iter()
            .map(|row| {
                self.columns
                    .iter()
                    .zip(row)
                    .map(|(col, val)| (col.name.clone(), val.clone()))
                    .collect()
            })
            .collect()
    }
}

#[derive(Debug, Serialize)]
pub struct QueryResultColumn {
    #[serde(skip_serializing)]
    pub table_oid: Option<u32>,
    #[serde(skip_serializing)]
    pub column_id: Option<i16>,

    pub name: String,
    pub index: usize,
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(flatten)]
    pub extended: Option<QueryResultColumnExtended>,
}

#[derive(Debug, Serialize)]
pub struct QueryResultColumnExtended {
    pub source_table: Option<String>,
    pub source_column: Option<String>,
    pub fk_constraint: Option<String>,
    pub fk_table: Option<String>,
    pub fk_column: Option<String>,
}

impl QueryResultColumn {
    /// Fetch additional information about the given set of columns, including the source table
    /// and column names and FKs. This will be accomplished in a single batch of queries.
    pub async fn fetch_extended(columns: &mut Vec<Self>, client: &Client) -> eyre::Result<()> {
        // this may overfetch a bit when the same column IDs exist across multiple tables,
        // but this is still better than not filtering by column ID at all
        let sql = "
        select
          n.nspname table_schema,
          a.attrelid::int table_id,
          a.attnum::int column_id,
          c.relname table_name,
          a.attname column_name
        from pg_attribute a
        join pg_class c on a.attrelid = c.oid
        join pg_namespace n on c.relnamespace = n.oid
        where a.attrelid = any($1)
        and a.attnum = any($2)";

        let table_ids = columns
            .iter()
            .filter_map(|col| col.table_oid)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let column_ids = columns
            .iter()
            .filter_map(|col| col.column_id)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();

        // we won't always have table/column IDs
        if table_ids.is_empty() || column_ids.is_empty() {
            return Ok(());
        }

        let stmt = prepare(&client, sql).await?;
        let rows = raw_query(client, &stmt, &[&table_ids, &column_ids]).await?;

        let attr_lookup: HashMap<(u32, i16), (String, String, String)> =
            HashMap::from_iter(rows.into_iter().map(|row| {
                (
                    (
                        // table OID
                        row[1].as_u64().unwrap() as u32,
                        // column ID
                        row[2].as_i64().unwrap() as i16,
                    ),
                    (
                        // table schema
                        row[0].as_str().unwrap().to_owned(),
                        // table name
                        row[3].as_str().unwrap().to_owned(),
                        // column name
                        row[4].as_str().unwrap().to_owned(),
                    ),
                )
            }));

        // switched to `pg_*` tables, since `constraint_column_usages`
        // requires that the current user _owns_ the table
        // see: https://stackoverflow.com/a/39379940/885098
        // let sql = "
        // select
        //   tc.constraint_name,
        //   kcu.table_name,
        //   kcu.column_name,
        //   ccu.table_name,
        //   ccu.column_name
        // from information_schema.table_constraints tc
        // join information_schema.key_column_usage kcu
        //   on tc.constraint_name = kcu.constraint_name
        //   and tc.table_schema = kcu.table_schema
        // join information_schema.constraint_column_usage ccu
        //   on ccu.constraint_name = tc.constraint_name
        // where tc.constraint_type = 'FOREIGN KEY'
        // and tc.table_schema = any($1)
        // and tc.table_name = any($2)";

        let sql = "
        SELECT 
          conname constraint_name,
          conrelid::regclass::text table_from,
          fa.attname column_from,
          confrelid::regclass::text table_to,
          da.attname column_to
          -- pg_get_constraintdef(c.oid) constraint_def
        FROM pg_constraint c 
        JOIN pg_namespace n 
          ON n.oid = c.connamespace
        CROSS JOIN LATERAL unnest(c.conkey) fk(k)
        JOIN pg_attribute fa
          ON fa.attrelid = c.conrelid
          AND fa.attnum = fk.k
        CROSS JOIN LATERAL unnest(c.confkey) dk(k)
        JOIN pg_attribute da
          ON da.attrelid = c.conrelid
          AND da.attnum = dk.k
        WHERE contype IN ('f')
        AND n.nspname = any($1)
        AND conrelid::regclass::text = any($2)";

        let table_schemas = attr_lookup
            .iter()
            .map(|(_, (table_schema, _, _))| table_schema.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let table_names = attr_lookup
            .iter()
            .map(|(_, (_, table_name, _))| table_name.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();

        let stmt = prepare(&client, sql).await?;
        let rows = raw_query(client, &stmt, &[&table_schemas, &table_names]).await?;

        let fk_lookup: HashMap<(String, String), (String, String, String)> =
            HashMap::from_iter(rows.into_iter().map(|row| {
                (
                    (
                        // source table name
                        row[1].as_str().unwrap().to_owned(),
                        // source column name
                        row[2].as_str().unwrap().to_owned(),
                    ),
                    (
                        // constraint name
                        row[0].as_str().unwrap().to_owned(),
                        // target table name
                        row[3].as_str().unwrap().to_owned(),
                        // target column name
                        row[4].as_str().unwrap().to_owned(),
                    ),
                )
            }));

        for col in columns.iter_mut() {
            if let Some(table_id) = col.table_oid
                && let Some(column_id) = col.column_id
                && let Some((_, table_name, column_name)) = attr_lookup.get(&(table_id, column_id))
            {
                let mut ext = QueryResultColumnExtended {
                    source_table: Some(table_name.clone()),
                    source_column: Some(column_name.clone()),
                    fk_constraint: None,
                    fk_table: None,
                    fk_column: None,
                };

                if let Some((constraint_name, target_table_name, target_column_name)) =
                    fk_lookup.get(&(table_name.clone(), column_name.clone()))
                {
                    ext.fk_constraint = Some(constraint_name.clone());
                    ext.fk_table = Some(target_table_name.clone());
                    ext.fk_column = Some(target_column_name.clone());
                }

                col.extended = Some(ext);
            }
        }

        Ok(())
    }
}

pub async fn version_info(client: &Client) -> eyre::Result<String> {
    let sql = "select version();";
    Ok(query(client, sql, &[]).await?.rows[0][0]
        .as_str()
        .unwrap()
        .to_owned())
}

pub async fn list_tables(client: &Client, schema: &str) -> eyre::Result<QueryRows> {
    let table_sql = "
    SELECT
      'table' as type,
      t.table_schema,
      t.table_name,
      c.reltuples as table_rows_est,
      pg_total_relation_size(concat(t.table_schema, '.', t.table_name)) as table_size,
      pg_size_pretty(pg_total_relation_size(concat(t.table_schema, '.', t.table_name))) as table_size_pretty
    FROM information_schema.tables t
    JOIN pg_namespace n ON n.nspname = t.table_schema
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = t.table_name
    WHERE t.table_schema = $1
    AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name";

    let view_sql = "
    SELECT
      'view' as type,
      v.table_schema,
      v.table_name,
      c.reltuples as table_rows_est,
      -1 as table_size,
      null as table_size_pretty
    FROM information_schema.views v
    JOIN pg_namespace n ON n.nspname = v.table_schema
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = v.table_name
    WHERE v.table_schema = $1
    ORDER BY v.table_name";

    // let mat_view_sql = format!(
    //     "SELECT 'materialized_view' as type, *
    //     FROM (\n{}\n) _
    //     WHERE table_schema = $1
    //     ORDER BY table_name",
    //     client.mat_view_query
    // );

    let (tables, views) = futures_util::future::try_join(
        query(client, table_sql, &[&schema]),
        query(client, view_sql, &[&schema]),
        // query(client, &mat_view_sql, &[&schema]),
    )
    .await?;

    Ok(tables
        .row_maps()
        .into_iter()
        .chain(views.row_maps().into_iter())
        // .chain(mat_views.row_maps().into_iter())
        .collect())
}

pub async fn list_columns(client: &Client, schema: &str, table: &str) -> eyre::Result<QueryResult> {
    let sql = "
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = $1
    AND table_name = $2
    ORDER BY ordinal_position";
    query(client, sql, &[&schema, &table]).await
}

pub async fn list_schemas(client: &Client) -> eyre::Result<QueryResult> {
    let sql = "
    SELECT *
    FROM information_schema.schemata
    WHERE schema_name NOT IN ('pg_catalog', 'pg_toast')
    ORDER BY schema_name";
    query(client, sql, &[]).await
}

pub async fn list_databases(client: &Client) -> eyre::Result<QueryResult> {
    let sql = "
    SELECT *
    FROM pg_database
    WHERE datname NOT IN ('template0', 'template1')
    ORDER BY datname";
    query(client, sql, &[]).await
}

pub async fn table_ddl(client: &Client, schema: &str, table: &str) -> eyre::Result<String> {
    // precision = np_radix ^ np_precision
    // typically uses 2 or 10 as the radix, e.g. 2^32 or 10^20
    let columns_sql = "
    SELECT
      column_name,
      column_default,
      is_nullable,
      data_type,
      character_maximum_length,
      numeric_precision,
      -- numeric_precision_radix,
      numeric_scale
    FROM information_schema.columns
    WHERE table_schema = $1
    AND table_name = $2
    ORDER BY ordinal_position";

    let indexes_sql = "
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = $1
    AND tablename = $2";

    let params: Vec<SqlParam> = vec![&schema, &table];
    let (columns, indexes) = futures_util::try_join!(
        query(client, columns_sql, &params),
        query(client, indexes_sql, &params),
    )?;

    let mut indexes = indexes.row_maps();
    let pkey_col_name = if let Some(i) = indexes
        .iter()
        .position(|i| i["indexname"].as_str().unwrap().ends_with("_pkey"))
    {
        // determine primary key column by parsing index definition
        // e.g. `CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)`
        let index = indexes.remove(i);
        let pkey_def = index["indexdef"].as_str().unwrap();
        let start_paren_idx = pkey_def.find("(").unwrap();
        let id_col_name = &pkey_def[start_paren_idx + 1..pkey_def.len() - 1];
        Some(id_col_name.to_owned())
    } else {
        None
    };

    let column_defs = columns
        .row_maps()
        .into_iter()
        .map(|row| {
            let col_name = row["column_name"].as_str().unwrap();
            let mut data_type = row["data_type"].as_str().unwrap();

            let prec_scale = if let Some(prec) = row["numeric_precision"].as_i64() {
                // Postgres differentiates between integer types using `numeric_precision`,
                // but the syntax is different from decimal types (the type name itself changes,
                // instead of using (prec, scale) postfix notation)
                match (data_type, prec) {
                    ("integer", 8) => {
                        data_type = "smallint";
                        None
                    }
                    ("integer", 16) => None,
                    ("integer", 32) => {
                        data_type = "bigint";
                        None
                    }
                    ("integer", _) => unreachable!("Postgres only supports 3 int precisions"),
                    ("smallint", _) => None,
                    ("bigint", _) => None,
                    _ => Some(format!(
                        "({}, {})",
                        prec,
                        row["numeric_scale"]
                            .as_i64()
                            .map(|n| n.to_string())
                            .unwrap_or("?".to_string()),
                    )),
                }
            } else {
                None
            };

            let char_len = if row["character_maximum_length"].is_null() {
                None
            } else {
                Some(format!(
                    "({})",
                    row["character_maximum_length"].as_i64().unwrap()
                ))
            };

            format!(
                "{} {}{}{}{}{}",
                col_name,
                data_type,
                prec_scale.or(char_len).as_deref().unwrap_or(""),
                if pkey_col_name.as_ref().is_some_and(|col| col == col_name) {
                    " PRIMARY KEY"
                } else {
                    ""
                },
                if row["is_nullable"].as_str().unwrap() == "YES" {
                    " NOT NULL"
                } else {
                    ""
                },
                // TODO: convert `int` / `nextval` to `serial`
                if let Some(default_val) = row["column_default"].as_str() {
                    format!(" DEFAULT {default_val}")
                } else {
                    "".to_owned()
                }
            )
        })
        .collect::<Vec<_>>();

    Ok(format!(
        "CREATE TABLE {} (\n  {}\n);{}",
        table,
        column_defs.join(",\n  "),
        if indexes.is_empty() {
            "".to_owned()
        } else {
            format!(
                "\n\n{}",
                indexes
                    .iter()
                    .map(|i| format!("{};", i["indexdef"].as_str().unwrap()))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        },
    ))
}

pub async fn view_ddl(client: &Client, schema: &str, view: &str) -> eyre::Result<String> {
    let sql = "
    SELECT view_definition
    FROM information_schema.views
    WHERE table_schema = $1
    AND table_name = $2";

    let res = query(client, sql, &[&schema, &view]).await?;
    Ok(res.rows[0][0].as_str().unwrap().to_owned())
}

pub async fn materialized_view_ddl(
    client: &Client,
    schema: &str,
    view: &str,
) -> eyre::Result<String> {
    let sql = format!(
        "SELECT view_definition
        FROM (\n{}\n) _
        WHERE table_schema = $1
        AND table_name = $2",
        client.mat_view_query,
    );

    let res = query(client, &sql, &[&schema, &view]).await?;
    Ok(res.rows[0][0].as_str().unwrap().to_owned())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sort {
    pub column_idx: usize,
    pub direction: SortDirection,
}

#[derive(Debug, Clone, SerializeDisplay, DeserializeFromStr)]
pub enum SortDirection {
    Asc,
    Desc,
}

impl std::fmt::Display for SortDirection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SortDirection::Asc => write!(f, "ASC"),
            SortDirection::Desc => write!(f, "DESC"),
        }
    }
}

impl std::str::FromStr for SortDirection {
    type Err = eyre::Report;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_uppercase().as_str() {
            "ASC" => Ok(SortDirection::Asc),
            "DESC" => Ok(SortDirection::Desc),
            _ => Err(eyre::eyre!("Invalid sort direction: {}", s)),
        }
    }
}

fn dyn_params(params: &Vec<Box<dyn ToSql + Sync + Send>>) -> Vec<SqlParam<'_>> {
    params.iter().map(|p| p.as_ref() as _).collect()
}

pub async fn paginated_query(
    client: &Client,
    raw_query: &str,
    params: &[serde_json::Value],
    filters: &[Filter],
    page: usize,
    page_size: isize,
    sort: Option<Sort>,
) -> eyre::Result<PaginatedQueryResult> {
    let raw_query = parse_query(raw_query);

    // DDL queries can't be counted/paginated like normal queries, but we
    // still support a pagination wrapper around their results; they'll always
    // return a single result representing the DDL command's output
    let query_type = query_type(&raw_query);
    if let QueryType::ModifyData | QueryType::ModifyStructure = query_type {
        let (stmt, params) = prepare_params(client, &raw_query, params).await?;
        let affected_rows = client.execute(&stmt.inner, &dyn_params(&params)).await?;

        return Ok(match query_type {
            QueryType::ModifyData => PaginatedQueryResult::ModifyData { affected_rows },
            QueryType::ModifyStructure => PaginatedQueryResult::ModifyStructure,
            _ => unreachable!(),
        });
    }

    // EXPLAIN queries just return a plan and are handled specially by the FE
    if let QueryType::Explain = query_type {
        let (stmt, params) = prepare_params(client, &raw_query, params).await?;
        let rows = client.query(&stmt.inner, &dyn_params(&params)).await?;

        let first_row = rows.get(0).unwrap();
        use tokio_postgres::types::Type;
        match first_row.columns()[0].type_() {
            &Type::JSON => {
                // with `FORMAT JSON`, everything's in the first row
                return Ok(PaginatedQueryResult::Explain {
                    query: raw_query,
                    plan: serde_json::to_string(&first_row.get::<_, serde_json::Value>(0)).unwrap(),
                });
            }

            &Type::TEXT => {
                // with `FORMAT TEXT`, output is newline-delimited across all rows
                return Ok(PaginatedQueryResult::Explain {
                    query: raw_query,
                    plan: rows
                        .iter()
                        .map(|row| row.get::<_, &str>(0))
                        .collect::<Vec<_>>()
                        .join("\n"),
                });
            }

            type_ => {
                panic!("Unexpected EXPLAIN result type: {type_}");
            }
        }
    }

    let inner_stmt = prepare(&client, &raw_query).await?;

    let filter_prefix = format!(
        "WITH q({}) AS (\n",
        inner_stmt
            .columns()
            .iter()
            .enumerate()
            .map(|(i, c)| Filter::col_name(i, c.name()))
            .collect::<Vec<_>>()
            .join(", ")
    );

    let select_aliases = inner_stmt
        .columns()
        .iter()
        .enumerate()
        .map(|(i, c)| {
            format!(
                "{} AS \"{}\"",
                Filter::col_name(i, c.name()),
                c.name().replace('"', "\"\"")
            )
        })
        .collect::<Vec<_>>()
        .join(", ");

    let filtered_query = format!(
        "{}{}\n)\nSELECT {} FROM q{}{}",
        filter_prefix,
        raw_query,
        select_aliases,
        if filters.is_empty() { "" } else { "\nWHERE " },
        filters
            .iter()
            .scan(0, |i, f| {
                match f.where_clause(*i) {
                    (true, clause) => {
                        *i = *i + 1;
                        Some(clause)
                    }
                    (false, clause) => Some(clause),
                }
            })
            .collect::<Vec<_>>()
            .join(" AND ")
    );

    let filter_params = filters
        .iter()
        .filter_map(|f| f.uses_param().then(|| f.value.clone()))
        .collect::<Vec<_>>();

    let params = params
        .into_iter()
        .cloned()
        .chain(filter_params.into_iter())
        .collect::<Vec<_>>();

    let (stmt, params) = prepare_params(&client, &filtered_query, &params).await?;

    let base_query = stmt.sql.as_str();

    let count_query = format!("SELECT COUNT(*) FROM (\n{base_query}\n) _;");

    let (page_query, page_query_offset) = if page_size < 0 {
        (base_query.to_owned(), 0)
    } else {
        let limit = page_size as usize;
        let offset = (page - 1) * limit;
        let page_query = format!(
            "SELECT * FROM (\n{base_query}\n) _ {} LIMIT {limit} OFFSET {offset};",
            sort.as_ref()
                .map(|s| format!("ORDER BY {} {}", s.column_idx + 1, s.direction))
                .unwrap_or_default()
        );

        (page_query, -16)
    };

    let (mut result, count_result) = futures_util::future::try_join(
        async {
            query(client, &page_query, &dyn_params(&params))
                .await
                .map_err(|err| match err.downcast::<PgError>() {
                    Ok(mut err) => {
                        err.offset_position(page_query_offset - (filter_prefix.len() as i32));
                        eyre::eyre!(err)
                    }
                    Err(err) => err,
                })
        },
        async {
            query(client, &count_query, &dyn_params(&params))
                .await
                .map_err(|err| match err.downcast::<PgError>() {
                    Ok(mut err) => {
                        err.offset_position(-23 - (filter_prefix.len() as i32));
                        eyre::eyre!(err)
                    }
                    Err(err) => err,
                })
        },
    )
    .await?;

    // fetch additional information, like source table and column names and FKs
    QueryResultColumn::fetch_extended(&mut result.columns, client).await?;

    let page_count = result.rows.len();
    let total_count = count_result.rows[0][0].as_u64().unwrap() as usize;
    let total_pages = if page_size < 0 {
        1
    } else {
        total_count.div_ceil(page_size as usize)
    };

    Ok(PaginatedQueryResult::Select {
        page,
        page_size,
        page_count,
        total_count,
        total_pages,
        sort,
        entries: result,
    })
}

#[derive(Debug)]
pub struct PreparedStatement {
    pub sql: String,
    pub inner: tokio_postgres::Statement,
    pub columns: Vec<QueryResultColumn>,
}

impl std::ops::Deref for PreparedStatement {
    type Target = tokio_postgres::Statement;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

pub async fn prepare(client: &Client, raw_sql: &str) -> eyre::Result<PreparedStatement> {
    let sql = parse_query(raw_sql);
    let stmt = client.prepare(&sql).await.map_err(PgError::from)?;

    let columns = stmt
        .columns()
        .iter()
        .enumerate()
        .map(|(idx, col)| QueryResultColumn {
            index: idx,
            table_oid: col.table_oid(),
            column_id: col.column_id(),
            name: col.name().to_owned(),
            type_: col.type_().name().to_owned(),
            extended: None,
        })
        .collect::<Vec<_>>();

    Ok(PreparedStatement {
        sql,
        inner: stmt,
        columns,
    })
}

pub async fn prepare_params(
    client: &Client,
    raw_sql: &str,
    params: &[serde_json::Value],
) -> eyre::Result<(PreparedStatement, Vec<Box<dyn ToSql + Sync + Send>>)> {
    let stmt = prepare(&client, raw_sql).await?;

    if stmt.params().len() != params.len() {
        eyre::bail!(
            "Expected {} params, got {}",
            stmt.params().len(),
            params.len()
        );
    }

    let params = params
        .iter()
        .zip(stmt.params().iter().cloned())
        .map(|(param, param_type)| from_json(param, param_type))
        .collect::<Result<Vec<_>, _>>()?;

    Ok((stmt, params))
}

pub async fn query(
    client: &Client,
    raw_sql: &str,
    params: &[SqlParam<'_>],
) -> eyre::Result<QueryResult> {
    let stmt = prepare(client, raw_sql).await?;
    Ok(QueryResult {
        rows: raw_query(client, &stmt, params).await?,
        columns: stmt.columns,
    })
}

async fn raw_query(
    client: &Client,
    statement: &PreparedStatement,
    params: &[SqlParam<'_>],
) -> eyre::Result<Vec<Vec<serde_json::Value>>> {
    if statement.columns().iter().all(col_supported) {
        let rows = client
            .query(&statement.inner, params)
            .await
            .map_err(PgError::from)?;

        let mut data_rows: Vec<Vec<serde_json::Value>> = Vec::with_capacity(rows.len());
        for row in rows {
            let mut data_row: Vec<serde_json::Value> =
                Vec::with_capacity(statement.columns().len());
            // use column index to get value instead of name in case of duplicate column names
            for (idx, col) in statement.columns().iter().enumerate() {
                if let Some(val) = to_json(&row, col, idx) {
                    data_row.push(val);
                }
            }
            data_rows.push(data_row);
        }

        Ok(data_rows)
    } else {
        // fall back on simple query (uses TEXT instead of BINARY encoding)
        tracing::info!("falling back on TEXT encoding");

        if !params.is_empty() {
            eyre::bail!("TEXT encoding does not support parameters");
        }

        let rows = client
            .simple_query(&statement.sql)
            .await
            .map_err(PgError::from)?;

        let mut data_rows: Vec<Vec<serde_json::Value>> = Vec::with_capacity(rows.len());
        for cmd in rows {
            use tokio_postgres::SimpleQueryMessage::*;
            match cmd {
                RowDescription(_) => {}
                CommandComplete(_) => {}
                Row(row) => {
                    let mut data_row: Vec<serde_json::Value> =
                        Vec::with_capacity(statement.columns().len());
                    for (idx, _) in statement.columns().iter().enumerate() {
                        data_row.push(row.get(idx).into());
                    }
                    data_rows.push(data_row);
                }
                _ => unreachable!("non-exhaustive enum"),
            }
        }

        Ok(data_rows)
    }
}

#[derive(Debug)]
pub struct PgError {
    source: tokio_postgres::error::Error,
    inner: Option<PgErrorInner>,
}

#[derive(Debug)]
struct PgErrorInner {
    code: String,
    message: String,
    severity: String,
    position: Option<u32>,
}

impl PgError {
    pub fn has_extended(&self) -> bool {
        self.inner.is_some()
    }

    pub fn code(&self) -> Option<&String> {
        self.inner.as_ref().map(|inner| &inner.code)
    }

    pub fn message(&self) -> Option<&String> {
        self.inner.as_ref().map(|inner| &inner.message)
    }

    pub fn severity(&self) -> Option<&String> {
        self.inner.as_ref().map(|inner| &inner.severity)
    }

    pub fn position(&self) -> Option<u32> {
        self.inner.as_ref().and_then(|inner| inner.position)
    }

    pub fn offset_position(&mut self, offset_by: i32) {
        self.inner
            .as_mut()
            .and_then(|inner| inner.position.as_mut())
            .map(|pos| *pos = ((*pos as i32) + offset_by) as u32);
    }
}

impl std::error::Error for PgError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.source)
    }
}

impl std::fmt::Display for PgError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(inner) = &self.inner {
            write!(f, "{} {}: {}", inner.severity, inner.code, inner.message)?;
            if let Some(pos) = inner.position {
                write!(f, " (at position {pos})")?;
            }
        } else {
            write!(f, "{}", self.source)?;
        }

        Ok(())
    }
}

impl From<tokio_postgres::error::Error> for PgError {
    fn from(source: tokio_postgres::error::Error) -> Self {
        let inner = if let Some(err) = source.as_db_error() {
            Some(PgErrorInner {
                code: err.code().code().to_owned(),
                message: err.message().to_owned(),
                severity: err.severity().to_owned(),
                position: err
                    .position()
                    .and_then(|p| match p {
                        tokio_postgres::error::ErrorPosition::Original(pos) => Some(pos),
                        // TODO: handle `Internal` error position (this seems to occur when
                        // Postgres generates its own query that's for some reason valid/erroneous)
                        tokio_postgres::error::ErrorPosition::Internal { .. } => None,
                    })
                    .copied(),
            })
        } else {
            None
        };

        Self { source, inner }
    }
}

/// Remove any comments and takes the first semicolon-delimited query.
fn parse_query(query: &str) -> String {
    // remove any comments
    let mut chars = query.chars().peekable();
    let mut acc = String::new();

    while let Some(c) = chars.next() {
        match c {
            '-' => {
                if chars.next_if(|&c| c == '-').is_some() {
                    // we're in a line comment, trim until newline
                    while let Some(c) = chars.next() {
                        if c == '\n' {
                            break;
                        }
                    }
                } else {
                    acc.push('-');
                }
            }
            '/' => {
                if chars.next_if(|&c| c == '*').is_some() {
                    loop {
                        // we're in a block comment, trim until close delimiter
                        match chars.next() {
                            Some('*') => {
                                if chars.next_if(|&c| c == '/').is_some() {
                                    break;
                                }
                            }
                            _ => {}
                        }
                    }
                } else {
                    acc.push('/');
                }
            }
            _ => acc.push(c),
        };
    }

    let query = acc.trim().to_string();

    // only take the first statement
    match query.split_once(';') {
        None => query,
        Some((q, "")) => q.to_string(),
        Some((q, _)) => {
            tracing::warn!("query contained more than one statement");
            q.to_string()
        }
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum QueryType {
    /// DML SELECT statement
    Select,
    /// DML INSERT / UPDATE / DELETE statement
    ModifyData,
    /// DDL CREATE / ALTER / DROP / TRUNCATE / COMMENT statement
    ModifyStructure,
    /// EXPLAIN statement
    Explain,
}

fn query_type(query: &str) -> QueryType {
    let query = query.to_ascii_lowercase();
    let tokens = query.split(&[' ', '\n']);

    for token in tokens {
        match token {
            "explain" => return QueryType::Explain,
            "insert" | "update" | "delete" => return QueryType::ModifyData,
            "create" | "alter" | "drop" | "truncate" | "comment" => {
                return QueryType::ModifyStructure;
            }
            _ => {}
        }
    }

    QueryType::Select
}

fn col_supported(col: &tokio_postgres::Column) -> bool {
    use tokio_postgres::types::Type;
    match *col.type_() {
        Type::TEXT
        | Type::VARCHAR
        | Type::NAME
        | Type::CHAR
        | Type::BOOL
        | Type::INT8
        | Type::INT4
        | Type::INT2
        | Type::FLOAT8
        | Type::NUMERIC
        | Type::FLOAT4
        | Type::JSONB
        | Type::JSON
        | Type::DATE
        | Type::TIME
        | Type::TIMESTAMP
        | Type::TIMESTAMPTZ => true,
        _ => match col.type_().name() {
            "citext" => true,
            _ => false,
        },
    }
}

// FIXME: add support for *_ARRAY types
fn to_json(
    row: &tokio_postgres::Row,
    col: &tokio_postgres::Column,
    idx: usize,
) -> Option<serde_json::Value> {
    use tokio_postgres::types::Type;
    match *col.type_() {
        Type::TEXT | Type::VARCHAR | Type::NAME | Type::CHAR => {
            let val: Option<&str> = row.get(idx);
            Some(val.into())
        }
        Type::BOOL => {
            let val: Option<bool> = row.get(idx);
            Some(val.into())
        }
        Type::INT8 => {
            let val: Option<i64> = row.get(idx);
            Some(val.into())
        }
        Type::INT4 => {
            let val: Option<i32> = row.get(idx);
            Some(val.into())
        }
        Type::INT2 => {
            let val: Option<i16> = row.get(idx);
            Some(val.into())
        }
        Type::FLOAT8 => {
            let val: Option<f64> = row.get(idx);
            Some(val.into())
        }
        Type::FLOAT4 => {
            let val: Option<f32> = row.get(idx);
            Some(val.into())
        }
        Type::NUMERIC => {
            let val: Option<Decimal> = row.get(idx);
            Some(val.map(|d| d.to_string()).into())
        }
        Type::JSONB | Type::JSON => {
            let val: Option<serde_json::Value> = row.get(idx);
            Some(val.into())
        }
        Type::DATE => {
            let iso_date = format_description!("[year]-[month]-[day]");
            let val: Option<time::Date> = row.get(idx);
            Some(val.map(|d| d.format(&iso_date).unwrap()).into())
        }
        Type::TIME => {
            let iso_time = format_description!("[hour]:[minute]:[second]");
            let val: Option<time::Time> = row.get(idx);
            Some(val.map(|t| t.format(&iso_time).unwrap()).into())
        }
        Type::TIMESTAMP => {
            let iso_datetime = format_description!("[year]-[month]-[day] [hour]:[minute]:[second]");
            let val: Option<time::PrimitiveDateTime> = row.get(idx);
            Some(val.map(|t| t.format(&iso_datetime).unwrap()).into())
        }
        Type::TIMESTAMPTZ => {
            let iso_datetime_tz = format_description!(
                "[year]-[month]-[day] [hour]:[minute]:[second] [offset_hour]:[offset_minute]"
            );
            let val: Option<time::OffsetDateTime> = row.get(idx);
            Some(val.map(|t| t.format(&iso_datetime_tz).unwrap()).into())
        }
        _ => {
            match col.type_().name() {
                // citext is a case-insensitive text type
                "citext" => {
                    let val: Option<&str> = row.get(idx);
                    Some(val.into())
                }
                _ => {
                    tracing::warn!("unsupported type: {:?}", col.type_());
                    None
                }
            }
        }
    }
}

fn from_json(
    json: &serde_json::Value,
    type_: tokio_postgres::types::Type,
) -> eyre::Result<Box<dyn ToSql + Sync + Send>> {
    use tokio_postgres::types::Type;
    match type_ {
        Type::TEXT | Type::VARCHAR | Type::NAME | Type::CHAR => json
            .as_str()
            .ok_or(eyre::eyre!("expected string"))
            .map(|s| Box::new(s.to_owned()) as _),
        Type::BOOL => json
            .as_bool()
            .ok_or(eyre::eyre!("expected boolean"))
            .map(|b| Box::new(b) as _),
        Type::INT8 | Type::INT4 | Type::INT2 => json
            .as_i64()
            .ok_or(eyre::eyre!("expected integer"))
            .map(|i| Box::new(i) as _),
        Type::FLOAT8 | Type::FLOAT4 => json
            .as_f64()
            .ok_or(eyre::eyre!("expected float"))
            .map(|f| Box::new(f) as _),
        Type::NUMERIC => json
            .as_f64()
            .ok_or(eyre::eyre!("expected float"))
            .map(|f| Box::new(Decimal::from_f64_retain(f).unwrap()) as _),
        Type::TIMESTAMP => {
            let s = json.as_str().ok_or(eyre::eyre!("expected string"))?;
            let date_time =
                match s.len() {
                    // parse as date, assume 00:00:00 for time
                    10 => time::Date::parse(s, format_description!("[year]-[month]-[day]")).map(
                        |d| time::PrimitiveDateTime::new(d, time::Time::from_hms(0, 0, 0).unwrap()),
                    )?,
                    // parse as datetime
                    19 => time::PrimitiveDateTime::parse(
                        s,
                        format_description!("[year]-[month]-[day] [hour]:[minute]:[second]"),
                    )?,
                    _ => eyre::bail!(
                        "invalid timestamp format, expected YYYY-MM-DD or YYYY-MM-DD HH:MM:SS"
                    ),
                };

            Ok(Box::new(date_time) as _)
        }
        _ => {
            match type_.name() {
                // citext is a case-insensitive text type
                "citext" => json
                    .as_str()
                    .ok_or(eyre::eyre!("expected string"))
                    .map(|s| Box::new(s.to_owned()) as _),
                _ => Err(eyre::eyre!("unsupported type: {:?}", type_)),
            }
        }
    }
}

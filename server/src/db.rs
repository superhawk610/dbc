use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use serde::Serialize;
use std::collections::HashMap;
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
    #[builder(default = 30)]
    pub pool_timeout_s: u64,
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

pub struct Connection {
    pub client: tokio_postgres::Client,
    pub tx: Option<Sender<()>>,
    pub rx: Option<Receiver<()>>,
}

impl std::ops::Deref for Connection {
    type Target = tokio_postgres::Client;

    fn deref(&self) -> &Self::Target {
        &self.client
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
    pub async fn kill(&mut self) {
        if let Some(tx) = self.tx.take() {
            let _ = tx.send(());
        }
    }
}

pub async fn connect(config: &Config) -> eyre::Result<Connection> {
    let (live_tx, live_rx) = channel();
    let (kill_tx, kill_rx) = channel();

    if config.ssl {
        let tls = MakeTlsConnector::new(TlsConnector::new()?);
        let (client, conn) = tokio_postgres::connect(&config.conn_str(), tls).await?;

        spawn_conn(conn, live_tx, kill_rx);

        Ok(Connection {
            client,
            rx: Some(live_rx),
            tx: Some(kill_tx),
        })
    } else {
        let (client, conn) =
            tokio_postgres::connect(&config.conn_str(), tokio_postgres::NoTls).await?;

        spawn_conn(conn, live_tx, kill_rx);

        Ok(Connection {
            client,
            rx: Some(live_rx),
            tx: Some(kill_tx),
        })
    }
}

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<QueryResultColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
    /// Whether or not the query contained DDL (Data Definition Language).
    /// When `false`, the statement only contained DML (Data Manipulation Language).
    /// When `true`, the client should refresh any cached schemas, as they may have changed.
    pub is_ddl: bool,
}

#[derive(Debug, Serialize)]
pub struct PaginatedQueryResult {
    /// 1-indexed page number.
    pub page: usize,
    /// The number of rows included in a single page.
    pub page_size: usize,
    /// The number of rows contained in the current page.
    pub page_count: usize,
    /// The total number of rows available across all pages.
    pub total_count: usize,
    /// The total number of pages.
    pub total_pages: usize,
    /// The current page.
    pub entries: QueryResult,
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
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
}

// TODO: probably need to optimize this per-database to filter out things
// like system tables, partitions, etc.
// see: https://stackoverflow.com/a/58243669/885098
pub async fn list_tables(
    client: &tokio_postgres::Client,
    schema: &str,
) -> eyre::Result<QueryResult> {
    let sql = "
    SELECT *
    FROM information_schema.tables
    WHERE table_schema = $1
    AND table_type = 'BASE TABLE'
    ORDER BY table_name";
    query(client, sql, &[&schema]).await
}

pub async fn list_schemas(client: &tokio_postgres::Client) -> eyre::Result<QueryResult> {
    let sql = "
    SELECT *
    FROM information_schema.schemata
    WHERE schema_name NOT IN ('pg_catalog', 'pg_toast')
    ORDER BY schema_name";
    query(client, sql, &[]).await
}

pub async fn list_databases(client: &tokio_postgres::Client) -> eyre::Result<QueryResult> {
    let sql = "
    SELECT *
    FROM pg_database
    WHERE datname NOT IN ('template0', 'template1')
    ORDER BY datname";
    query(client, sql, &[]).await
}

pub async fn table_ddl(
    client: &tokio_postgres::Client,
    schema: &str,
    table: &str,
) -> eyre::Result<String> {
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
                        row["numeric_scale"].as_i64().unwrap(),
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

pub async fn paginated_query(
    client: &tokio_postgres::Client,
    raw_query: &str,
    params: &[SqlParam<'_>],
    page: usize,
    page_size: usize,
) -> eyre::Result<PaginatedQueryResult> {
    fn indent(s: &str) -> String {
        format!("  {}", s.replace('\n', "\n  "))
    }

    let base_query = parse_query(raw_query);

    // DDL queries can't be counted/paginated like normal queries, but we
    // still support a pagination wrapper around their results; they'll always
    // return a single result representing the DDL command's output
    if is_ddl(&base_query) {
        return Ok(PaginatedQueryResult {
            page: 1,
            page_size,
            page_count: 1,
            total_count: 1,
            total_pages: 1,
            entries: query(client, &base_query, params).await?,
        });
    }

    let base_query = indent(&base_query);
    let count_query = format!("SELECT COUNT(*) FROM (\n{base_query}\n);");

    let limit = page_size;
    let offset = (page - 1) * page_size;
    let page_query = format!("SELECT * FROM (\n{base_query}\n) LIMIT {limit} OFFSET {offset};");

    let (result, count_result) = futures_util::future::try_join(
        query(client, &page_query, params),
        query(client, &count_query, params),
    )
    .await?;

    let page_count = result.rows.len();
    let total_count = count_result.rows[0][0].as_u64().unwrap() as usize;
    let total_pages = total_count.div_ceil(page_size);

    Ok(PaginatedQueryResult {
        page,
        page_size,
        page_count,
        total_count,
        total_pages,
        entries: result,
    })
}

pub async fn query(
    client: &tokio_postgres::Client,
    raw_query: &str,
    params: &[SqlParam<'_>],
) -> eyre::Result<QueryResult> {
    let query = parse_query(raw_query);
    let stmt = client.prepare(&query).await.map_err(PgError::from)?;

    let columns = stmt
        .columns()
        .iter()
        .map(|col| QueryResultColumn {
            name: col.name().to_owned(),
            type_: col.type_().name().to_owned(),
        })
        .collect::<Vec<_>>();

    if stmt.columns().iter().all(col_supported) {
        let rows = client.query(&stmt, params).await.map_err(PgError::from)?;

        let mut data_rows: Vec<Vec<serde_json::Value>> = Vec::with_capacity(rows.len());
        for row in rows {
            let mut data_row: Vec<serde_json::Value> = Vec::with_capacity(columns.len());
            for col in stmt.columns() {
                if let Some(val) = to_json(&row, col) {
                    data_row.push(val);
                }
            }
            data_rows.push(data_row);
        }

        Ok(QueryResult {
            columns,
            rows: data_rows,
            is_ddl: is_ddl(&query),
        })
    } else {
        // fall back on simple query (uses TEXT instead of BINARY encoding)
        tracing::info!("falling back on TEXT encoding");

        let rows = client.simple_query(&query).await.map_err(PgError::from)?;

        let mut data_rows: Vec<Vec<serde_json::Value>> = Vec::with_capacity(rows.len());
        for cmd in rows {
            use tokio_postgres::SimpleQueryMessage::*;
            match cmd {
                RowDescription(_) => {}
                CommandComplete(_) => {}
                Row(row) => {
                    let mut data_row: Vec<serde_json::Value> = Vec::with_capacity(columns.len());
                    for col in stmt.columns() {
                        data_row.push(row.get(col.name()).into());
                    }
                    data_rows.push(data_row);
                }
                _ => unreachable!("non-exhaustive enum"),
            }
        }

        Ok(QueryResult {
            columns,
            rows: data_rows,
            is_ddl: is_ddl(&query),
        })
    }
}

#[derive(Debug)]
struct PgError {
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

fn is_ddl(query: &str) -> bool {
    let query = query.to_ascii_lowercase();
    ["create", "alter", "drop", "truncate", "comment"]
        .iter()
        .any(|verb| query.contains(verb))
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

fn to_json(row: &tokio_postgres::Row, col: &tokio_postgres::Column) -> Option<serde_json::Value> {
    use tokio_postgres::types::Type;
    match *col.type_() {
        Type::TEXT | Type::VARCHAR | Type::NAME | Type::CHAR => {
            let val: Option<&str> = row.get(col.name());
            Some(val.into())
        }
        Type::BOOL => {
            let val: Option<bool> = row.get(col.name());
            Some(val.into())
        }
        Type::INT8 => {
            let val: Option<i64> = row.get(col.name());
            Some(val.into())
        }
        Type::INT4 => {
            let val: Option<i32> = row.get(col.name());
            Some(val.into())
        }
        Type::INT2 => {
            let val: Option<i16> = row.get(col.name());
            Some(val.into())
        }
        Type::FLOAT8 | Type::NUMERIC => {
            let val: Option<f64> = row.get(col.name());
            Some(val.into())
        }
        Type::FLOAT4 => {
            let val: Option<f32> = row.get(col.name());
            Some(val.into())
        }
        Type::JSONB | Type::JSON => {
            let val: Option<serde_json::Value> = row.get(col.name());
            Some(val.into())
        }
        Type::DATE => {
            use time::format_description::well_known::Iso8601;
            let val: Option<time::Date> = row.get(col.name());
            Some(val.map(|d| d.format(&Iso8601::DATE).unwrap()).into())
        }
        Type::TIME => {
            use time::format_description::well_known::Iso8601;
            let val: Option<time::Time> = row.get(col.name());
            Some(val.map(|t| t.format(&Iso8601::TIME).unwrap()).into())
        }
        Type::TIMESTAMP => {
            use time::format_description::well_known::Iso8601;
            let val: Option<time::PrimitiveDateTime> = row.get(col.name());
            Some(val.map(|t| t.format(&Iso8601::DATE_TIME).unwrap()).into())
        }
        Type::TIMESTAMPTZ => {
            use time::format_description::well_known::Iso8601;
            let val: Option<time::OffsetDateTime> = row.get(col.name());
            Some(val.map(|t| t.format(&Iso8601::DEFAULT).unwrap()).into())
        }
        _ => {
            match col.type_().name() {
                // citext is a case-insensitive text type
                "citext" => {
                    let val: Option<&str> = row.get(col.name());
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

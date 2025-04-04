use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use serde::Serialize;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::oneshot::{Receiver, Sender, channel};
use tokio_postgres::Socket;

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
    #[builder(default = 10)]
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

// TODO: register into connection pool
pub fn spawn_conn<T>(conn: tokio_postgres::Connection<Socket, T>, tx: Sender<()>)
where
    T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        if let Err(e) = conn.await {
            tracing::error!("connection error: {}", e);
            tx.send(()).unwrap();
        }
    });
}

pub struct Connection {
    pub client: tokio_postgres::Client,
    pub rx: Receiver<()>,
}

impl std::ops::Deref for Connection {
    type Target = tokio_postgres::Client;

    fn deref(&self) -> &Self::Target {
        &self.client
    }
}

pub async fn connect(config: &Config) -> eyre::Result<Connection> {
    let (tx, rx) = channel();

    if config.ssl {
        let tls = MakeTlsConnector::new(TlsConnector::new()?);
        let (client, conn) = tokio_postgres::connect(&config.conn_str(), tls).await?;

        spawn_conn(conn, tx);

        Ok(Connection { client, rx })
    } else {
        let (client, conn) =
            tokio_postgres::connect(&config.conn_str(), tokio_postgres::NoTls).await?;

        spawn_conn(conn, tx);

        Ok(Connection { client, rx })
    }
}

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<QueryResultColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
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
pub async fn list_tables(client: &tokio_postgres::Client) -> eyre::Result<QueryResult> {
    let sql = "
    SELECT *
    FROM information_schema.tables
    WHERE table_schema = $1
    AND table_type = 'BASE TABLE'
    ORDER BY table_name";
    query(client, sql, &[&"public"]).await
}

pub async fn list_schemas(client: &tokio_postgres::Client) -> eyre::Result<QueryResult> {
    let sql = "
    SELECT *
    FROM information_schema.schemata
    ORDER BY schema_name";
    query(client, sql, &[]).await
}

pub async fn list_databases(client: &tokio_postgres::Client) -> eyre::Result<QueryResult> {
    let sql = "
    SELECT *
    FROM pg_database
    ORDER BY datname";
    query(client, sql, &[]).await
}

pub async fn query(
    client: &tokio_postgres::Client,
    raw_query: &str,
    params: &[&(dyn tokio_postgres::types::ToSql + Sync)],
) -> eyre::Result<QueryResult> {
    let query = match raw_query.split_once(';') {
        None => raw_query,
        Some((q, _)) => {
            tracing::warn!("query contained more than one statement");
            q
        }
    };

    let stmt = client.prepare(query).await?;

    let columns = stmt
        .columns()
        .iter()
        .map(|col| QueryResultColumn {
            name: col.name().to_owned(),
            type_: col.type_().name().to_owned(),
        })
        .collect::<Vec<_>>();

    if stmt.columns().iter().all(col_supported) {
        let rows = client.query(&stmt, params).await?;

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
        })
    } else {
        // fall back on simple query (uses TEXT instead of BINARY encoding)
        tracing::info!("falling back on TEXT encoding");

        let rows = client.simple_query(query).await?;

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
        })
    }
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

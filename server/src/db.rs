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
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

// TODO: probably need to optimize this per-database to filter out things
// like system tables, partitions, etc.
// see: https://stackoverflow.com/a/58243669/885098
pub async fn list_tables(client: &tokio_postgres::Client) -> eyre::Result<QueryResult> {
    let sql = "SELECT * FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name";
    query(client, sql, &[&"public"]).await
}

pub async fn query(
    client: &tokio_postgres::Client,
    query: &str,
    params: &[&(dyn tokio_postgres::types::ToSql + Sync)],
) -> eyre::Result<QueryResult> {
    let stmt = client.prepare(query).await?;
    let rows = client.query(&stmt, params).await?;

    let columns = stmt
        .columns()
        .iter()
        .map(|col| col.name().to_owned())
        .collect::<Vec<_>>();

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
        _ => {
            tracing::warn!("unsupported type: {:?}", col.type_());
            None
        }
    }
}

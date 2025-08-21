use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tokio::sync::{Mutex, RwLock};

pub mod db;
pub mod persistence;
pub mod pool;
pub mod server;
pub mod stream;

#[derive(Debug, PartialEq, Eq, Hash)]
pub struct ConnectionKey {
    connection: String,
    database: String,
}

pub struct State {
    pub pools: Mutex<HashMap<ConnectionKey, pool::ConnectionPool>>,
    pub config: RwLock<persistence::Store>,
}

impl State {
    /// Check out a database connection for the default database of the given connection.
    pub async fn get_default_conn(
        &self,
        connection: String,
    ) -> eyre::Result<pool::CheckedOutConnection> {
        let config = self.config.read().await;
        let conn = config
            .connections
            .iter()
            .find(|c| c.name == connection)
            .ok_or(eyre::eyre!("no connection named {}", connection))?;
        let database = conn.database.clone();
        drop(config);

        self.get_conn(connection, database).await
    }

    /// Check out a database connection from the pool for the given connection name.
    /// If this is the first time this has been called for that connection, this will
    /// spawn the connection pool first.
    pub async fn get_conn(
        &self,
        connection: String,
        database: String,
    ) -> eyre::Result<pool::CheckedOutConnection> {
        let conn_key = ConnectionKey {
            connection,
            database,
        };

        // use an existing connection pool if one already exists
        let mut pools = self.pools.lock().await;
        if let Some(pool) = pools.get_mut(&conn_key) {
            return pool.get_conn().await;
        }

        let msg = format!(
            "Opening connection pool for db \"{}\" on conn \"{}\"...",
            conn_key.database, conn_key.connection
        );
        tracing::info!("{msg}");
        crate::stream::broadcast(msg).await;

        // if not, spawn a new connection pool
        let config = self.config.read().await;
        let mut connection = config
            .connections
            .iter()
            .find(|c| c.name == conn_key.connection)
            .cloned()
            .ok_or(eyre::eyre!("no connection named {}", conn_key.connection))?;
        drop(config);

        // load password (run `password_file` if required)
        if let Some(p) = connection.password_file() {
            crate::stream::broadcast(format!("Fetching password via \"{}\":\n", p)).await;
        }
        let stderr = dbg!(connection.load_password().await)?;
        if let Some(stderr) = stderr {
            crate::stream::broadcast(stderr).await;
        }

        let cfg = crate::db::Config::from(&connection);
        match crate::pool::ConnectionPool::new(cfg).await {
            Ok(mut pool) => {
                let pool_size = pool.pool_size().await;
                tracing::info!("Success! {pool_size} connections in pool.");
                crate::stream::broadcast(format!("Success! {pool_size} connections in pool."))
                    .await;

                let conn = pool.get_conn().await?;
                let version_info = crate::db::version_info(&conn).await?;
                crate::stream::broadcast(version_info).await;

                let mut entry = pools.entry(conn_key).insert_entry(pool);
                entry.get_mut().get_conn().await
            }

            Err(err) => {
                tracing::error!("Error opening connection: {err}");
                crate::stream::broadcast(format!("Failed to open connection\n{err}")).await;
                Err(err)
            }
        }
    }

    /// Print a debug representation of the application state. This has to
    /// be a method instead of a `Debug` implementation because it's `async`.
    pub async fn debug(&self) -> String {
        let pools = self.pools.lock().await;
        let mut counts = Vec::new();
        for (conn, pool) in pools.iter() {
            counts.push(format!(
                "=== connection: \"{}\" on \"{}\" ===\n{}",
                conn.database,
                conn.connection,
                pool.debug().await
            ));
        }
        counts.join("\n")
    }
}

pub fn config_dir() -> &'static Path {
    static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();
    CONFIG_DIR.get_or_init(|| {
        // create app config directory if it doesn't already exist
        let config_dir = shellexpand::tilde("~/.config/dbc");
        let config_dir = PathBuf::from(config_dir.as_ref());
        if !config_dir.exists() {
            std::fs::create_dir_all(&config_dir).unwrap();
        }
        config_dir
    })
}

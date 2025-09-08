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

/// When attempting to create a connection pool, it's possible that it will fail.
/// This enum represents the result of that attempt, where `Ok` means that the
/// pool was successfully created, and `Err` means that it failed, likely due
/// to failure to load the password from a script file or invalid connection
/// parameters.
pub enum PoolResult {
    Ok(pool::ConnectionPool),
    Err(String),
}

impl PoolResult {
    pub fn inner_mut(&mut self) -> &mut pool::ConnectionPool {
        match self {
            PoolResult::Ok(pool) => pool,
            PoolResult::Err(_) => panic!("not an Ok variant"),
        }
    }

    /// Returns a tuple of `(is_connected, status_message)`.
    pub async fn status(&mut self) -> eyre::Result<(bool, String)> {
        match self {
            PoolResult::Ok(pool) => {
                let conn = pool.get_conn().await?;
                let version_info = crate::db::version_info(&conn).await?;
                Ok((true, version_info))
            }
            PoolResult::Err(err) => Ok((false, err.clone())),
        }
    }
}

pub struct State {
    pub pools: Mutex<HashMap<ConnectionKey, PoolResult>>,
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
        match pools.get_mut(&conn_key) {
            Some(PoolResult::Ok(pool)) => return pool.get_conn().await,
            Some(PoolResult::Err(err)) => eyre::bail!(err.clone()),
            None => {}
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
        if let Err(err) = connection.load_password().await {
            let err = eyre::eyre!("Failed to load password: {}", err);
            crate::stream::broadcast(err.to_string()).await;
            pools.insert(conn_key, PoolResult::Err(err.to_string()));
            return Err(err);
        }

        match create_pool(&connection).await? {
            res @ PoolResult::Ok(_) => {
                let mut entry = pools.entry(conn_key).insert_entry(res);
                entry.get_mut().inner_mut().get_conn().await
            }

            PoolResult::Err(err) => {
                let res = eyre::eyre!("Failed to open connection pool: {}", err);
                pools.insert(conn_key, PoolResult::Err(err));
                Err(res)
            }
        }
    }

    pub async fn status(&self) -> eyre::Result<Vec<serde_json::Value>> {
        let mut pools = self.pools.lock().await;
        let mut acc = Vec::new();

        for (conn, pool) in pools.iter_mut() {
            let (is_connected, status) = pool.status().await?;
            acc.push(serde_json::json!({
                "connection": conn.connection,
                "database": conn.database,
                "connected": is_connected,
                "status": status,
            }));
        }

        Ok(acc)
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
                match pool {
                    PoolResult::Ok(pool) => pool.debug().await,
                    PoolResult::Err(err) => err.clone(),
                }
            ));
        }
        counts.join("\n")
    }
}

pub(crate) async fn create_pool(conn: &crate::persistence::Connection) -> eyre::Result<PoolResult> {
    let cfg = crate::db::Config::from(conn);
    match crate::pool::ConnectionPool::new(cfg).await {
        Ok(mut pool) => {
            let pool_size = pool.pool_size().await;
            tracing::info!("Success! {pool_size} connections in pool.");
            crate::stream::broadcast(format!("Success! {pool_size} connections in pool.")).await;

            let conn = pool.get_conn().await?;
            let version_info = crate::db::version_info(&conn).await?;
            crate::stream::broadcast(version_info).await;

            Ok(PoolResult::Ok(pool))
        }

        Err(err) => {
            tracing::error!("Error opening connection: {err}");
            crate::stream::broadcast(format!("Failed to open connection\n{err}")).await;
            Ok(PoolResult::Err(err.to_string()))
        }
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

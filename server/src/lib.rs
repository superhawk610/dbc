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

pub struct State {
    pub pools: RwLock<HashMap<String, pool::ConnectionPool>>,
    pub config: RwLock<persistence::Store>,
    pub worker: Mutex<stream::StreamWorker>,
}

impl State {
    /// Check out a database connection from the pool for the given connection name.
    /// If this is the first time this has been called for that connection, this will
    /// spawn the connection pool first.
    pub async fn get_conn(&self, conn_name: &str) -> eyre::Result<pool::CheckedOutConnection> {
        // use an existing connection pool if one already exists
        let pools = self.pools.read().await;
        if let Some(pool) = pools.get(conn_name) {
            return pool.get_conn().await;
        }
        drop(pools);

        // if not, switch to a write lock; we need to check again after acquiring
        // the lock, since another thread may have also been waiting and initialized
        // the connection pool before us
        let mut pools = self.pools.write().await;
        if let Some(pool) = pools.get(conn_name) {
            return pool.get_conn().await;
        }

        tracing::info!("spawning new connection pool for \"{conn_name}\"");
        self.broadcast(format!("Opening connection pool for \"{conn_name}\"..."))
            .await;

        // if not, spawn a new connection pool
        let config = self.config.read().await;
        let connection = config
            .connections
            .iter()
            .find(|c| c.name == conn_name)
            .cloned()
            .ok_or(eyre::eyre!("no connection named {conn_name}"))?;
        drop(config);

        let cfg = crate::db::Config::from(&connection);
        match crate::pool::ConnectionPool::new(cfg).await {
            Ok(pool) => {
                let pool_size = pool.pool_size().await;
                tracing::info!("Success! {pool_size} connections in pool.");
                self.broadcast(format!("Success! {pool_size} connections in pool."))
                    .await;

                let entry = pools.entry(conn_name.to_owned()).insert_entry(pool);
                entry.get().get_conn().await
            }

            Err(err) => {
                tracing::error!("Error opening connection: {err}");
                self.broadcast(format!("Failed to open connection\n{err}"))
                    .await;
                Err(err)
            }
        }
    }

    /// Shortcut for `self.worker.broadcast(message)`. This will acquire and then
    /// drop the worker's mutex internally, so avoid calling this from a loop.
    pub async fn broadcast(&self, message: impl Into<String>) {
        let mut worker = self.worker.lock().await;
        worker.broadcast(message.into()).await.unwrap();
    }

    /// Print a debug representation of the application state. This has to
    /// be a method instead of a `Debug` implementation because it's `async`.
    pub async fn debug(&self) -> String {
        let pools = self.pools.read().await;
        let mut counts = Vec::new();
        for (conn, pool) in pools.iter() {
            counts.push(format!(
                "=== connection: \"{conn}\" ===\n{}",
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

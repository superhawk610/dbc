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
        let pool = crate::pool::ConnectionPool::new(cfg).await;
        let entry = pools.entry(conn_name.to_owned()).insert_entry(pool);

        entry.get().get_conn().await
    }

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

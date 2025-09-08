use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};
use tokio::sync::{Mutex, Notify, RwLock, oneshot};

pub mod db;
pub mod persistence;
pub mod pool;
pub mod server;
pub mod stream;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConnectionKey {
    connection: String,
    database: String,
}

/// While a pool is connecting (which may take some time), we
/// use the `Pending` variant to indicate that the pool is
/// being opened, instead of holding the lock.
pub enum PoolState {
    /// The pool is active and ready to use.
    Active(pool::ConnectionPool),

    /// The pool failed to open and cannot be used.
    Failed(String),

    /// The pool is being opened. If you didn't create this variant, you
    /// should subscribe to `notify.notified()` to be notified when the
    /// pool is ready to use. If you want to cancel the pool creation,
    /// send a message to `cancel`. Subscribers should check the pool
    /// state after receiving a notification, as it may have failed or
    /// been cancelled.
    Pending {
        notify: Arc<Notify>,
        cancel: Option<oneshot::Sender<()>>,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PoolStatus {
    Active,
    Failed,
    Pending,
}

impl PoolState {
    pub fn inner_mut(&mut self) -> &mut pool::ConnectionPool {
        match self {
            PoolState::Active(pool) => pool,
            _ => panic!("pool isn't active"),
        }
    }

    /// Returns a tuple of `(status, status_message)`.
    pub async fn status(&mut self) -> eyre::Result<(PoolStatus, String)> {
        match self {
            PoolState::Active(pool) => {
                let conn = pool.get_conn().await?;
                let version_info = crate::db::version_info(&conn).await?;
                Ok((PoolStatus::Active, version_info))
            }
            PoolState::Pending { .. } => Ok((PoolStatus::Pending, "connecting...".to_string())),
            PoolState::Failed(err) => Ok((PoolStatus::Failed, err.clone())),
        }
    }
}

pub struct State {
    pub pools: Mutex<HashMap<ConnectionKey, PoolState>>,
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
        if let Some(state) = pools.get_mut(&conn_key) {
            match state {
                PoolState::Failed(err) => eyre::bail!(err.clone()),
                PoolState::Active(pool) => return pool.get_conn().await,
                PoolState::Pending { notify, .. } => {
                    // release lock and wait for the creation task to finish
                    let notified = Arc::clone(notify).notified_owned();
                    drop(pools);

                    notified.await;
                    return Box::pin(self.get_conn(conn_key.connection, conn_key.database)).await;
                }
            }
        }

        let msg = format!(
            "Opening connection pool for db \"{}\" on conn \"{}\"...",
            conn_key.database, conn_key.connection
        );
        tracing::info!("{msg}");
        crate::stream::broadcast(msg).await;

        // leave a `Pending` marker in the state, then spawn the connection pool
        // drop the lock while we're doing this so that we don't block the app
        let notify = Arc::new(Notify::new());
        let (cancel_tx, mut cancel_rx) = oneshot::channel();
        pools.insert(
            conn_key.clone(),
            PoolState::Pending {
                notify: Arc::clone(&notify),
                cancel: Some(cancel_tx),
            },
        );
        drop(pools);

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

            let mut pools = self.pools.lock().await;

            // if we've been cancelled, recurse and try again
            if cancel_rx.try_recv().is_ok() {
                return Box::pin(self.get_conn(conn_key.connection, conn_key.database)).await;
            }

            pools.insert(conn_key, PoolState::Failed(err.to_string()));
            return Err(err);
        }

        let conn = match create_pool(&connection).await? {
            res @ PoolState::Active(_) => {
                let mut pools = self.pools.lock().await;

                // if we've been cancelled, recurse and try again
                if cancel_rx.try_recv().is_ok() {
                    return Box::pin(self.get_conn(conn_key.connection, conn_key.database)).await;
                }

                let mut entry = pools.entry(conn_key).insert_entry(res);
                entry.get_mut().inner_mut().get_conn().await
            }

            PoolState::Failed(err) => {
                let res = eyre::eyre!("Failed to open connection pool: {}", err);
                let mut pools = self.pools.lock().await;

                // if we've been cancelled, recurse and try again
                if cancel_rx.try_recv().is_ok() {
                    return Box::pin(self.get_conn(conn_key.connection, conn_key.database)).await;
                }

                pools.insert(conn_key, PoolState::Failed(err));
                Err(res)
            }

            _ => unreachable!(),
        };

        // once we're done, notify any other tasks waiting
        notify.notify_waiters();

        conn
    }

    pub async fn status(&self) -> eyre::Result<Vec<serde_json::Value>> {
        let mut pools = self.pools.lock().await;
        let mut acc = Vec::new();

        for (conn, pool) in pools.iter_mut() {
            let (status, status_msg) = pool.status().await?;
            acc.push(serde_json::json!({
                "connection": conn.connection,
                "database": conn.database,
                "status": status,
                "message": status_msg,
            }));
        }

        Ok(acc)
    }

    /// Print a debug representation of the application state. This has to
    /// be a method instead of a `Debug` implementation because it's `async`.
    pub async fn debug(&self) -> String {
        let pools = self.pools.lock().await;
        let mut counts = vec![format!("{} active connection pools", pools.len())];
        for (conn, pool) in pools.iter() {
            counts.push(format!(
                "=== connection: \"{}\" on \"{}\" ===\n{}",
                conn.database,
                conn.connection,
                match pool {
                    PoolState::Active(pool) => pool.debug().await,
                    PoolState::Failed(err) => err.clone(),
                    PoolState::Pending { .. } => "pending".to_string(),
                }
            ));
        }
        counts.join("\n")
    }
}

pub(crate) async fn create_pool(conn: &crate::persistence::Connection) -> eyre::Result<PoolState> {
    let cfg = crate::db::Config::from(conn);
    match crate::pool::ConnectionPool::new(cfg).await {
        Ok(mut pool) => {
            let pool_size = pool.pool_size().await;
            tracing::info!("Success! {pool_size} connections in pool.");
            crate::stream::broadcast(format!("Success! {pool_size} connections in pool.")).await;

            let conn = pool.get_conn().await?;
            let version_info = crate::db::version_info(&conn).await?;
            crate::stream::broadcast(version_info).await;

            Ok(PoolState::Active(pool))
        }

        Err(err) => {
            tracing::error!("Error opening connection: {err}");
            crate::stream::broadcast(format!("Failed to open connection\n{err}")).await;
            Ok(PoolState::Failed(err.to_string()))
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

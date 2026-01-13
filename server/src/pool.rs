use crate::db;
use std::{collections::VecDeque, sync::Arc};
use tokio::{
    select,
    sync::Mutex,
    sync::broadcast::{Sender, channel},
    sync::mpsc,
};

pub struct ConnectionPool {
    inner: Arc<Mutex<ConnectionPoolInner>>,
    timeout: std::time::Duration,
}

struct ConnectionPoolInner {
    live: bool,
    config: db::Config,
    conn_avail: Sender<()>,
    conns: VecDeque<db::Connection>,
    idle_timeout: std::time::Duration,
    health_check_timeout: std::time::Duration,
    not_idle: Option<mpsc::Sender<()>>,
    failed_health_checks: usize,
}

pub struct CheckedOutConnection {
    conn: Option<db::Connection>,
    pool: Option<Arc<Mutex<ConnectionPoolInner>>>,
}

impl Drop for CheckedOutConnection {
    fn drop(&mut self) {
        let mut conn = self.conn.take().unwrap();
        let pool = self.pool.take().unwrap();

        tokio::spawn(async move {
            let mut pool = pool.lock().await;

            // if the pool has been shut down, don't check the connection back in
            if !pool.live {
                return;
            }

            let was_empty = pool.conns.is_empty();

            // if this connection has terminated, we don't need to put it back into the pool;
            // instead, ask the pool to spawn a new connection
            if conn.is_live() {
                pool.conns.push_front(conn);
            } else {
                pool.spawn_conn().await.unwrap();
            }

            // if pool was empty, notify that a connection is now available
            if was_empty {
                let _ = pool.conn_avail.send(());
            }
        });
    }
}

impl std::ops::Deref for CheckedOutConnection {
    type Target = db::Connection;

    fn deref(&self) -> &Self::Target {
        self.conn.as_ref().unwrap()
    }
}

impl ConnectionPool {
    pub async fn new(config: db::Config) -> eyre::Result<Self> {
        let pool_size = config.pool_size;
        assert!(pool_size > 0, "pool size must be greater than 0");

        let timeout_s = config.pool_timeout_s;
        assert!(timeout_s > 0, "pool timeout must be greater than 0");

        let idle_timeout_s = config.idle_timeout_s;
        let idle_timeout = std::time::Duration::from_secs(idle_timeout_s);
        assert!(idle_timeout_s > 0, "idle timeout must be greater than 0");

        let (tx, _) = channel(pool_size);

        // "prime" the channel so that the first call to get_conn() doesn't block
        let _ = tx.send(());

        let health_check_timeout = std::time::Duration::from_secs(config.health_check_timeout_s);

        let mut inner = ConnectionPoolInner {
            live: true,
            config,
            conn_avail: tx,
            conns: VecDeque::new(),
            idle_timeout,
            health_check_timeout,
            // will be set by `spawn_idle_watcher`
            not_idle: None,
            failed_health_checks: 0,
        };

        // spawn initial connection tasks
        inner.init().await?;

        let mut this = Self {
            inner: Arc::new(Mutex::new(inner)),
            timeout: std::time::Duration::from_secs(timeout_s),
        };

        // spawn idle watcher
        this.spawn_idle_watcher().await;

        Ok(this)
    }

    async fn spawn_idle_watcher(&mut self) {
        tracing::debug!("spawning idle watcher");

        let mut inner = self.inner.lock().await;
        let (not_idle_tx, mut not_idle_rx) = mpsc::channel::<()>(1);
        inner.not_idle = Some(not_idle_tx);

        let idle_timeout = inner.idle_timeout;
        let inner = Arc::clone(&self.inner);
        tokio::spawn(async move {
            loop {
                if not_idle_rx.is_closed() {
                    tracing::debug!("closing idle watcher");
                    break;
                }

                if let Err(_) = tokio::time::timeout(idle_timeout, not_idle_rx.recv()).await {
                    tracing::info!("pool idle timeout reached, shutting down...");
                    crate::stream::broadcast("pool idle timeout reached, shutting down...").await;
                    let mut inner = inner.lock().await;
                    inner.go_dormant().await;
                    break;
                }

                tracing::debug!("still alive");
            }
        });
    }

    pub async fn pool_size(&self) -> usize {
        let inner = self.inner.lock().await;
        inner.config.pool_size
    }

    pub async fn get_conn(&mut self) -> eyre::Result<CheckedOutConnection> {
        let timeout = self.timeout;

        select! {
            // when a connection is checked back in, try to get it
            // it's possible that this fails if another thread was also
            // waiting for a connection, in which case we'll keep waiting
            conn = self.wait_for_conn() => {
                Ok(CheckedOutConnection {
                    conn: Some(conn?),
                    pool: Some(Arc::clone(&self.inner)),
                })
            }

            // if we've been waiting for a connection for too long, return an error
            _ = tokio::time::sleep(timeout) => {
                Err(eyre::eyre!("no connection available after {}s", timeout.as_secs()))
            }
        }
    }

    async fn wait_for_conn(&mut self) -> eyre::Result<db::Connection> {
        // try to get a connection from the pool
        let mut inner = self.inner.lock().await;

        // if the pool is dormant, reload it;
        // do this without dropping `inner` so that we keep the mutex lock
        // and don't recurse infinitely
        if !inner.live {
            tracing::debug!("pool is dormant, reloading...");
            crate::stream::broadcast("pool is dormant, reloading...").await;
            inner.init().await?;
            drop(inner);

            self.spawn_idle_watcher().await;

            return Box::pin(self.wait_for_conn()).await;
        }

        // get the next available connection, if any; if another thread took the
        // last available connection, wait for another to be checked back in
        if let Some(mut conn) = inner.conns.pop_back() {
            // validate connection health before returning it
            let health_check_timeout = inner.health_check_timeout;

            // perform health check to detect network issues
            if !conn.health_check(health_check_timeout).await {
                tracing::warn!("connection health check failed, spawning new connection");
                conn.kill();
                inner.failed_health_checks += 1;

                if inner.failed_health_checks >= 2 {
                    tracing::error!(
                        "connection unstable after {} consecutive failures, going dormant",
                        inner.failed_health_checks
                    );
                    crate::stream::broadcast("Connection unstable, going dormant. Please check your network/VPN connection.").await;
                    inner.go_dormant().await;
                    drop(inner);
                    return Err(eyre::eyre!(
                        "connection pool dormant due to consecutive failures"
                    ));
                }

                inner.spawn_conn().await?;
                drop(inner);
                return Box::pin(self.wait_for_conn()).await;
            }

            // health check passed, reset failure counter
            inner.failed_health_checks = 0;

            if let Some(not_idle) = inner.not_idle.as_ref() {
                let _ = not_idle.send(()).await;
            }

            return Ok(conn);
        }

        let mut conn_avail = inner.conn_avail.subscribe();
        drop(inner);

        // wait for another connection to become available and then recurse
        let _ = conn_avail.recv().await;

        Box::pin(self.wait_for_conn()).await
    }

    pub async fn is_unstable(&self) -> bool {
        let inner = self.inner.lock().await;
        inner.failed_health_checks > 0
    }

    /// Drop all existing connections in the pool and replace them with new connections.
    pub async fn reload(&mut self, updated_config: db::Config) -> eyre::Result<()> {
        tracing::debug!("reloading pool");

        let mut inner = self.inner.lock().await;
        inner.config = updated_config;
        inner.conns.clear();
        inner.init().await?;
        drop(inner);

        self.spawn_idle_watcher().await;

        Ok(())
    }

    pub async fn debug(&self) -> String {
        let inner = self.inner.lock().await;

        let live = inner.live;
        let pool_size = inner.config.pool_size;
        let available = inner.conns.len();
        let checked_out = pool_size - available;

        format!(
            "live={live}, checked_out={checked_out}, available={available}, pool_size={pool_size}"
        )
    }
}

impl ConnectionPoolInner {
    async fn spawn_conn(&mut self) -> eyre::Result<()> {
        let conn = db::connect(&self.config).await?;
        self.conns.push_front(conn);
        Ok(())
    }

    async fn init(&mut self) -> eyre::Result<()> {
        for _ in 0..self.config.pool_size {
            self.spawn_conn().await?;
        }

        self.live = true;
        self.failed_health_checks = 0;

        Ok(())
    }

    async fn go_dormant(&mut self) {
        self.live = false;
        self.conns.clear();
        self.not_idle = None;
        self.failed_health_checks = 0;
    }
}

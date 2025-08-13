use crate::db;
use std::{collections::VecDeque, sync::Arc};
use tokio::{
    select,
    sync::Mutex,
    sync::broadcast::{Sender, channel},
};

pub struct ConnectionPool {
    inner: Arc<Mutex<ConnectionPoolInner>>,
    timeout: std::time::Duration,
}

struct ConnectionPoolInner {
    config: db::Config,
    conns: VecDeque<db::Connection>,
    conn_avail: Sender<()>,
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

        let (tx, _) = channel(pool_size);

        // "prime" the channel so that the first call to get_conn() doesn't block
        let _ = tx.send(());

        let mut inner = ConnectionPoolInner {
            config,
            conns: VecDeque::new(),
            conn_avail: tx,
        };

        for _ in 0..pool_size {
            inner.spawn_conn().await?;
        }

        Ok(Self {
            inner: Arc::new(Mutex::new(inner)),
            timeout: std::time::Duration::from_secs(timeout_s),
        })
    }

    pub async fn pool_size(&self) -> usize {
        let inner = self.inner.lock().await;
        inner.config.pool_size
    }

    pub async fn get_conn(&self) -> eyre::Result<CheckedOutConnection> {
        // try to get a connection from the pool
        let mut inner = self.inner.lock().await;
        if let Some(conn) = inner.conns.pop_back() {
            return Ok(CheckedOutConnection {
                conn: Some(conn),
                pool: Some(Arc::clone(&self.inner)),
            });
        }

        // if no connection is available, wait for a connection to be checked back in
        let mut conn_avail = inner.conn_avail.subscribe();
        drop(inner);

        let timeout = tokio::time::sleep(self.timeout);
        tokio::pin!(timeout);

        loop {
            select! {
                // when a connection is checked back in, try to get it
                // it's possible that this fails if another thread was also
                // waiting for a connection, in which case we'll keep waiting
                _ = conn_avail.recv() => {
                    let mut inner = self.inner.lock().await;
                    if let Some(conn) = inner.conns.pop_back() {
                        return Ok(CheckedOutConnection {
                            conn: Some(conn),
                            pool: Some(Arc::clone(&self.inner)),
                        });
                    }
                }

                // if we've been waiting for a connection for too long, return an error
                _ = &mut timeout => {
                    return Err(eyre::eyre!("no connection available after {}s", self.timeout.as_secs()));
                }
            }
        }
    }

    /// Drop all existing connections in the pool and replace them with new connections.
    pub async fn reload(&mut self, config: db::Config) -> eyre::Result<()> {
        let mut inner = self.inner.lock().await;

        // drop and replace the list of connections
        inner.config = config;
        inner.conns = VecDeque::new();

        // spawn new connections to fill the pool
        for _ in 0..inner.config.pool_size {
            inner.spawn_conn().await?;
        }

        Ok(())
    }

    pub async fn debug(&self) -> String {
        let inner = self.inner.lock().await;
        let pool_size = inner.config.pool_size;
        let available = inner.conns.len();
        let checked_out = pool_size - available;
        format!("checked_out={checked_out}, available={available}, pool_size={pool_size}")
    }
}

impl ConnectionPoolInner {
    pub async fn spawn_conn(&mut self) -> eyre::Result<()> {
        let conn = db::connect(&self.config).await?;
        self.conns.push_front(conn);
        Ok(())
    }
}

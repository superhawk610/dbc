use std::sync::RwLock;
use tokio::sync::Mutex;

pub mod db;
pub mod persistence;
pub mod pool;
pub mod stream;

pub struct State {
    pub pool: pool::ConnectionPool,
    pub config: RwLock<persistence::Store>,
    pub worker: Mutex<stream::StreamWorker>,
}

use std::sync::RwLock;

pub mod db;
pub mod persistence;
pub mod pool;

pub struct State {
    pub pool: pool::ConnectionPool,
    pub config: RwLock<persistence::Store>,
}

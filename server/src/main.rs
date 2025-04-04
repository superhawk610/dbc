use poem::{
    EndpointExt, Route, Server, get,
    listener::TcpListener,
    post,
    web::{Data, Json},
};
use serde::Deserialize;
use std::sync::Arc;

#[tokio::main]
async fn main() -> eyre::Result<()> {
    dotenv::dotenv().ok();

    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .with_test_writer()
        .init();

    let cfg = dbc::db::Config::builder()
        .host(std::env::var("DB_HOST").expect("DB_HOST is set"))
        .port(
            std::env::var("DB_PORT")
                .expect("DB_PORT is set")
                .parse()
                .expect("DB_PORT is valid"),
        )
        .username(std::env::var("DB_USER").expect("DB_USER is set"))
        .password(std::env::var("DB_PASS").expect("DB_PASS is set"))
        .database(std::env::var("DB_DATABASE").expect("DB_DATABASE is set"))
        .build();

    let pool = dbc::pool::ConnectionPool::new(cfg).await;

    let state = Arc::new(dbc::State { pool });

    let router = Route::new()
        .at("/", get(handler))
        .at("/query", post(handle_query))
        .with(poem::middleware::Cors::new())
        .with(poem::middleware::Tracing)
        .data(state);

    Server::new(TcpListener::bind(&format!(
        "127.0.0.1:{}",
        std::env::var("API_PORT").expect("API_PORT is set")
    )))
    .run(router)
    .await?;

    Ok(())
}

#[poem::handler]
async fn handler(Data(state): Data<&Arc<dbc::State>>) -> eyre::Result<Json<dbc::db::QueryResult>> {
    let conn = state.pool.get_conn().await?;
    Ok(Json(dbc::db::list_tables(&conn).await?))
}

#[derive(Deserialize)]
struct Query {
    query: String,
}

#[poem::handler]
async fn handle_query(
    Data(state): Data<&Arc<dbc::State>>,
    Json(query): Json<Query>,
) -> eyre::Result<Json<dbc::db::QueryResult>> {
    let conn = state.pool.get_conn().await?;
    Ok(Json(dbc::db::query(&conn, &query.query, &[]).await?))
}

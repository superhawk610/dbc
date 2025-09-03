use futures_util::SinkExt;
use poem::{
    IntoResponse,
    web::{
        Data, Json, Path, TypedHeader,
        websocket::{Message, WebSocket},
    },
};
use serde::Deserialize;
use std::{collections::HashSet, sync::Arc};

pub mod debug;
pub mod headers;

pub async fn format_eyre<E: poem::Endpoint>(
    next: E,
    req: poem::Request,
) -> poem::Result<poem::Response> {
    use poem::IntoResponse;
    let mut res = next.call(req).await?.into_response();

    // eyre errors are converted to text, but the content-type header isn't set
    if res.content_type().is_none() {
        res = res.set_content_type("text/plain");
    }

    Ok(res)
}

#[poem::handler]
pub async fn websocket(ws: WebSocket, Path(_channel): Path<String>) -> impl IntoResponse {
    let (tx, mut rx) = tokio::sync::mpsc::channel(100);
    crate::stream::subscribe(tx).await.unwrap();

    ws.on_upgrade(|mut socket| async move {
        // use futures_util::StreamExt;
        // if let Some(Ok(Message::Text(text))) = socket.next().await {
        //     dbg!(text);
        //     let _ = socket.send(Message::Text("hello, world!".into())).await;
        // }

        loop {
            if let Some(line) = rx.recv().await {
                match socket.send(Message::Text(line)).await {
                    Err(_) => break,
                    _ => {}
                }
            }
        }
    })
}

#[poem::handler]
pub async fn get_config(Data(state): Data<&Arc<crate::State>>) -> Json<serde_json::Value> {
    let config = state.config.read().await;
    Json(serde_json::json!({ "connections": config.connections }))
}

#[derive(Debug, serde::Deserialize)]
struct UpdateConfig {
    pub connections: Vec<crate::persistence::Connection>,
}

#[poem::handler]
pub async fn update_config(
    Json(updated_config): Json<UpdateConfig>,
    Data(state): Data<&Arc<crate::State>>,
) -> eyre::Result<poem::http::StatusCode> {
    let mut config = state.config.write().await;
    config.connections = updated_config
        .connections
        .into_iter()
        .map(crate::persistence::Connection::from)
        .collect();
    config.persist().unwrap();

    // TODO: only changed connections should restart their pools
    crate::stream::broadcast("Settings updated, restarting active connections...").await;

    let mut pools = state.pools.lock().await;
    let mut close_pools = HashSet::new();
    for (conn, pool) in pools.iter_mut() {
        match config
            .connections
            .iter_mut()
            .find(|c| c.name.eq(&conn.connection))
        {
            // if the connection is still present in the config, reload the pool
            Some(conn) => {
                if let Some(stderr) = conn.load_password().await? {
                    crate::stream::broadcast(stderr).await;
                }

                if let Err(err) = pool.reload((&*conn).into()).await {
                    crate::stream::broadcast(err.to_string()).await;
                }
            }

            // otherwise, slate for removal
            None => {
                close_pools.insert(conn.connection.clone());
            }
        }
    }

    // close any connection pools that are no longer active
    pools.retain(|k, _| !close_pools.contains(&k.connection));

    crate::stream::broadcast("Done!").await;

    Ok(poem::http::StatusCode::NO_CONTENT)
}

#[poem::handler]
pub async fn connection_info(
    Data(state): Data<&Arc<crate::State>>,
    Path(connection): Path<String>,
) -> eyre::Result<Json<serde_json::Value>> {
    let conn = state.get_default_conn(connection).await?;
    let info = crate::db::version_info(&conn).await?;
    Ok(Json(serde_json::json!({ "info": info })))
}

#[poem::handler]
pub async fn get_databases(
    TypedHeader(connection): TypedHeader<headers::XConnName>,
    Data(state): Data<&Arc<crate::State>>,
) -> eyre::Result<Json<crate::db::QueryRows>> {
    let conn = state.get_default_conn(connection.into()).await?;
    Ok(Json(crate::db::list_databases(&conn).await?.row_maps()))
}

#[poem::handler]
pub async fn get_schemas(
    TypedHeader(connection): TypedHeader<headers::XConnName>,
    TypedHeader(database): TypedHeader<headers::XDatabase>,
    Data(state): Data<&Arc<crate::State>>,
) -> eyre::Result<Json<crate::db::QueryRows>> {
    let conn = state.get_conn(connection.into(), database.into()).await?;
    Ok(Json(crate::db::list_schemas(&conn).await?.row_maps()))
}

#[poem::handler]
pub async fn get_tables(
    TypedHeader(connection): TypedHeader<headers::XConnName>,
    TypedHeader(database): TypedHeader<headers::XDatabase>,
    Data(state): Data<&Arc<crate::State>>,
    Path(schema): Path<String>,
) -> eyre::Result<Json<crate::db::QueryRows>> {
    let conn = state.get_conn(connection.into(), database.into()).await?;
    Ok(Json(crate::db::list_tables(&conn, &schema).await?))
}

#[poem::handler]
pub async fn get_columns(
    TypedHeader(connection): TypedHeader<headers::XConnName>,
    TypedHeader(database): TypedHeader<headers::XDatabase>,
    Data(state): Data<&Arc<crate::State>>,
    Path((schema, table)): Path<(String, String)>,
) -> eyre::Result<Json<Vec<String>>> {
    let conn = state.get_conn(connection.into(), database.into()).await?;
    Ok(Json(
        crate::db::list_columns(&conn, &schema, &table)
            .await?
            .row_maps()
            .into_iter()
            .map(|c| c["column_name"].as_str().unwrap().to_owned())
            .collect(),
    ))
}

#[poem::handler]
pub async fn get_table_ddl(
    TypedHeader(connection): TypedHeader<headers::XConnName>,
    TypedHeader(database): TypedHeader<headers::XDatabase>,
    Data(state): Data<&Arc<crate::State>>,
    Path((schema, table)): Path<(String, String)>,
) -> eyre::Result<Json<serde_json::Value>> {
    let conn = state.get_conn(connection.into(), database.into()).await?;
    let ddl = crate::db::table_ddl(&conn, &schema, &table).await?;
    Ok(Json(serde_json::json!({ "ddl": ddl })))
}

#[poem::handler]
pub async fn get_view_ddl(
    TypedHeader(connection): TypedHeader<headers::XConnName>,
    TypedHeader(database): TypedHeader<headers::XDatabase>,
    Data(state): Data<&Arc<crate::State>>,
    Path((schema, view)): Path<(String, String)>,
) -> eyre::Result<Json<serde_json::Value>> {
    let conn = state.get_conn(connection.into(), database.into()).await?;
    let ddl = crate::db::view_ddl(&conn, &schema, &view).await?;
    Ok(Json(serde_json::json!({ "ddl": ddl })))
}

#[poem::handler]
pub async fn get_materialized_view_ddl(
    TypedHeader(connection): TypedHeader<headers::XConnName>,
    TypedHeader(database): TypedHeader<headers::XDatabase>,
    Data(state): Data<&Arc<crate::State>>,
    Path((schema, view)): Path<(String, String)>,
) -> eyre::Result<Json<serde_json::Value>> {
    let conn = state.get_conn(connection.into(), database.into()).await?;
    let ddl = crate::db::materialized_view_ddl(&conn, &schema, &view).await?;
    Ok(Json(serde_json::json!({ "ddl": ddl })))
}

#[derive(Deserialize)]
struct QueryParams {
    pub query: String,
    pub params: Option<Vec<serde_json::Value>>,
    pub sort: Option<crate::db::Sort>,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Debug)]
pub enum PaginatedQueryError {
    Eyre(eyre::Report),
    DbError(crate::db::PgError),
}

impl std::error::Error for PaginatedQueryError {}

impl std::fmt::Display for PaginatedQueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PaginatedQueryError::Eyre(err) => write!(f, "{}", err),
            PaginatedQueryError::DbError(err) => write!(f, "{}", err),
        }
    }
}

impl poem::error::ResponseError for PaginatedQueryError {
    fn status(&self) -> poem::http::StatusCode {
        poem::http::StatusCode::INTERNAL_SERVER_ERROR
    }

    fn as_response(&self) -> poem::Response
    where
        Self: std::error::Error + Send + Sync + 'static,
    {
        let res = poem::Response::builder().status(self.status());

        match self {
            PaginatedQueryError::Eyre(err) => {
                return res.body(format!("{err}"));
            }

            PaginatedQueryError::DbError(err) => {
                if err.has_extended() {
                    return res.content_type("application/json").body(
                        serde_json::json!({
                            "type": "PgError",
                            "code": err.code(),
                            "position": err.position(),
                            "message": err.message(),
                            "severity": err.severity(),
                        })
                        .to_string(),
                    );
                } else {
                    return res.body(format!("{}", err));
                }
            }
        }
    }
}

#[poem::handler]
pub async fn handle_query(
    TypedHeader(connection): TypedHeader<headers::XConnName>,
    TypedHeader(database): TypedHeader<headers::XDatabase>,
    Data(state): Data<&Arc<crate::State>>,
    Json(params): Json<QueryParams>,
) -> Result<Json<crate::db::PaginatedQueryResult>, PaginatedQueryError> {
    let conn = state
        .get_conn(connection.into(), database.into())
        .await
        .map_err(|err| PaginatedQueryError::Eyre(err))?;
    Ok(Json(
        crate::db::paginated_query(
            &conn,
            &params.query,
            &params.params.unwrap_or_default(),
            params.page,
            params.page_size,
            params.sort,
        )
        .await
        .map_err(|err| match err.downcast::<crate::db::PgError>() {
            Ok(err) => PaginatedQueryError::DbError(err),
            Err(err) => PaginatedQueryError::Eyre(err),
        })?,
    ))
}

#[derive(Deserialize)]
pub struct PrepareQueryParams {
    pub query: String,
}

#[poem::handler]
pub async fn prepare_query(
    TypedHeader(connection): TypedHeader<headers::XConnName>,
    TypedHeader(database): TypedHeader<headers::XDatabase>,
    Data(state): Data<&Arc<crate::State>>,
    Json(params): Json<PrepareQueryParams>,
) -> Result<Json<serde_json::Value>, PaginatedQueryError> {
    let conn = state
        .get_conn(connection.into(), database.into())
        .await
        .map_err(|err| PaginatedQueryError::Eyre(err))?;
    let stmt = crate::db::prepare(&conn, &params.query)
        .await
        .map_err(|err| match err.downcast::<crate::db::PgError>() {
            Ok(err) => PaginatedQueryError::DbError(err),
            Err(err) => PaginatedQueryError::Eyre(err),
        })?;

    Ok(Json(serde_json::json!({
        "columns": stmt.columns,
        "params": stmt.params().iter().enumerate().map(|(i, p)| serde_json::json!({
            "name": format!("${}", i + 1),
            "type": p.name(),
        })).collect::<Vec<_>>(),
    })))
}

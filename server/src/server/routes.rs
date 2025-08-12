use futures_util::{SinkExt, StreamExt};
use poem::{
    IntoResponse,
    web::{
        Data, Json, Path, TypedHeader,
        headers::{Header, HeaderName, HeaderValue},
        websocket::{Message, WebSocket},
    },
};
use serde::Deserialize;
use std::{ops::Deref, sync::Arc};

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

struct XConnName(String);

static X_CONN_NAME: HeaderName = HeaderName::from_static("x-conn-name");

impl Header for XConnName {
    fn name() -> &'static HeaderName {
        &X_CONN_NAME
    }

    fn decode<'i, I>(values: &mut I) -> Result<Self, poem::web::headers::Error>
    where
        Self: Sized,
        I: Iterator<Item = &'i HeaderValue>,
    {
        Ok(Self(
            values
                .next()
                .ok_or(poem::web::headers::Error::invalid())?
                .to_str()
                .map_err(|_| poem::web::headers::Error::invalid())?
                .to_owned(),
        ))
    }

    fn encode<E: Extend<HeaderValue>>(&self, _values: &mut E) {
        panic!("not implemented")
    }
}

impl Deref for XConnName {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[poem::handler]
pub async fn websocket(
    ws: WebSocket,
    Path(channel): Path<String>,
    Data(state): Data<&Arc<crate::State>>,
) -> impl IntoResponse {
    dbg!(channel);

    let (tx, mut rx) = tokio::sync::mpsc::channel(100);
    let mut worker = state.worker.lock().await;
    worker.subscribe(tx).await.unwrap();

    ws.on_upgrade(|mut socket| async move {
        if let Some(Ok(Message::Text(text))) = socket.next().await {
            dbg!(text);

            let _ = socket.send(Message::Text("hello, world!".into())).await;
        }

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
    Json(serde_json::json!({
        "connections": config.connections.iter().map(crate::persistence::DecryptedConnection::from).collect::<Vec<_>>(),
    }))
}

#[derive(Debug, serde::Deserialize)]
struct UpdateConfig {
    pub connections: Vec<crate::persistence::DecryptedConnection>,
}

#[poem::handler]
pub async fn update_config(
    Json(config): Json<UpdateConfig>,
    Data(state): Data<&Arc<crate::State>>,
) -> poem::http::StatusCode {
    dbg!(config);
    poem::http::StatusCode::NO_CONTENT
}

#[poem::handler]
pub async fn get_databases(
    TypedHeader(conn_name): TypedHeader<XConnName>,
    Data(state): Data<&Arc<crate::State>>,
) -> eyre::Result<Json<crate::db::QueryRows>> {
    let conn = state.get_conn(&conn_name).await?;
    Ok(Json(crate::db::list_databases(&conn).await?.row_maps()))
}

#[poem::handler]
pub async fn get_schemas(
    TypedHeader(conn_name): TypedHeader<XConnName>,
    Data(state): Data<&Arc<crate::State>>,
) -> eyre::Result<Json<crate::db::QueryRows>> {
    let conn = state.get_conn(&conn_name).await?;
    Ok(Json(crate::db::list_schemas(&conn).await?.row_maps()))
}

#[poem::handler]
pub async fn get_tables(
    TypedHeader(conn_name): TypedHeader<XConnName>,
    Data(state): Data<&Arc<crate::State>>,
    Path(schema): Path<String>,
) -> eyre::Result<Json<crate::db::QueryRows>> {
    let conn = state.get_conn(&conn_name).await?;
    Ok(Json(
        crate::db::list_tables(&conn, &schema).await?.row_maps(),
    ))
}

#[poem::handler]
pub async fn get_table_ddl(
    TypedHeader(conn_name): TypedHeader<XConnName>,
    Data(state): Data<&Arc<crate::State>>,
    Path(table_name): Path<String>,
) -> eyre::Result<Json<serde_json::Value>> {
    let conn = state.get_conn(&conn_name).await?;
    let ddl = crate::db::table_ddl(&conn, &table_name).await?;
    Ok(Json(serde_json::json!({ "ddl": ddl })))
}

#[derive(Deserialize)]
struct QueryParams {
    pub query: String,
    pub page: usize,
    pub page_size: usize,
}

#[poem::handler]
pub async fn handle_query(
    TypedHeader(conn_name): TypedHeader<XConnName>,
    Data(state): Data<&Arc<crate::State>>,
    Json(params): Json<QueryParams>,
) -> eyre::Result<Json<crate::db::PaginatedQueryResult>> {
    let conn = state.get_conn(&conn_name).await?;
    Ok(Json(
        crate::db::paginated_query(&conn, &params.query, &[], params.page, params.page_size)
            .await?,
    ))
}

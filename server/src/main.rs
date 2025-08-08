use futures_util::{SinkExt, StreamExt};
use poem::{
    EndpointExt, IntoResponse, Route, Server, get,
    listener::TcpListener,
    post,
    web::{
        Data, Json, Path,
        websocket::{Message, WebSocket},
    },
};
use serde::Deserialize;
use std::sync::{Arc, RwLock};
use tokio::sync::Mutex;

#[tokio::main]
async fn main() -> eyre::Result<()> {
    dotenv::dotenv().ok();

    // start up stream worker
    let worker = dbc::stream::StreamWorker::new();

    if let Err(err) =
        dbc::persistence::load_encryption_key(std::env::var("ENCRYPTION_KEY").ok().as_deref())
    {
        println!("{}", err);
        std::process::exit(1);
    };

    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .with_test_writer()
        .init();

    let mut store = dbg!(dbc::persistence::Store::load().unwrap());
    if store.connections.is_empty() {
        let db_host = std::env::var("DB_HOST").expect("DB_HOST is set");
        let db_port = std::env::var("DB_PORT")
            .expect("DB_PORT is set")
            .parse()
            .expect("DB_PORT is valid");
        let db_user = std::env::var("DB_USER").expect("DB_USER is set");
        let db_pass = std::env::var("DB_PASS").expect("DB_PASS is set");
        let db_database = std::env::var("DB_DATABASE").expect("DB_DATABASE is set");

        let connection = dbc::persistence::Connection {
            name: "default".to_owned(),
            host: db_host,
            port: db_port,
            username: db_user,
            password: dbc::persistence::EncryptedString::new(db_pass),
            database: db_database,
        };

        store.connections.push(connection);
        store.persist().unwrap();
    }

    let connection = &store.connections[0];
    let cfg = dbc::db::Config::builder()
        .host(connection.host.clone())
        .port(connection.port)
        .username(connection.username.clone())
        .password(connection.password.clone())
        .database(connection.database.clone())
        .build();

    let pool = dbc::pool::ConnectionPool::new(cfg).await;

    let state = Arc::new(dbc::State {
        pool,
        config: RwLock::new(store),
        worker: Mutex::new(worker),
    });

    async fn format_eyre<E: poem::Endpoint>(
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

    let router = Route::new()
        .at("/:channel", get(websocket))
        .nest(
            "/db",
            Route::new()
                .at("/databases", get(get_databases))
                .at("/schemas", get(get_schemas))
                .at("/schemas/:schema/tables", get(get_tables))
                .at("/ddl/table/:table_name", get(get_table_ddl)),
        )
        .at("/config", get(get_config).put(update_config))
        .at("/query", post(handle_query))
        .with(poem::middleware::Cors::new())
        .with(poem::middleware::Tracing)
        .around(format_eyre)
        .data(state);

    let server_addr = format!(
        "127.0.0.1:{}",
        std::env::var("API_PORT").expect("API_PORT is set")
    );

    let _server_handle = tokio::spawn(async move {
        Server::new(TcpListener::bind(&server_addr))
            .run(router)
            .await
            .unwrap();
    });

    #[cfg(feature = "bundle")]
    {
        use tao::{
            dpi::LogicalSize,
            event::{Event, WindowEvent},
            event_loop::{ControlFlow, EventLoop},
            window::WindowBuilder,
        };
        use wry::WebViewBuilder;

        let event_loop = EventLoop::new();
        let window = WindowBuilder::new()
            .with_title("dbc")
            .with_inner_size(LogicalSize::new(1100, 700))
            .build(&event_loop)
            .unwrap();

        // TODO: build assets with cargo script, host on ephemeral port
        let _webview = WebViewBuilder::new()
            .with_url("http://localhost:5173")
            .build(&window)
            .unwrap();

        event_loop.run(move |event, _, control_flow| {
            *control_flow = ControlFlow::Wait;

            if let Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } = event
            {
                *control_flow = ControlFlow::Exit;
            }
        });
    }

    #[cfg(not(feature = "bundle"))]
    {
        _server_handle.await.unwrap();
        Ok(())
    }
}

#[poem::handler]
async fn websocket(
    ws: WebSocket,
    Path(channel): Path<String>,
    Data(state): Data<&Arc<dbc::State>>,
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
async fn get_config(Data(state): Data<&Arc<dbc::State>>) -> Json<serde_json::Value> {
    let config = state.config.read().unwrap();
    Json(serde_json::json!({
        "connections": config.connections.iter().map(dbc::persistence::DecryptedConnection::from).collect::<Vec<_>>(),
    }))
}

#[derive(Debug, serde::Deserialize)]
struct UpdateConfig {
    pub connections: Vec<dbc::persistence::DecryptedConnection>,
}

#[poem::handler]
async fn update_config(
    Json(config): Json<UpdateConfig>,
    Data(state): Data<&Arc<dbc::State>>,
) -> poem::http::StatusCode {
    dbg!(config);
    poem::http::StatusCode::NO_CONTENT
}

#[poem::handler]
async fn get_databases(
    Data(state): Data<&Arc<dbc::State>>,
) -> eyre::Result<Json<dbc::db::QueryRows>> {
    let conn = state.pool.get_conn().await?;
    Ok(Json(dbc::db::list_databases(&conn).await?.row_maps()))
}

#[poem::handler]
async fn get_schemas(
    Data(state): Data<&Arc<dbc::State>>,
) -> eyre::Result<Json<dbc::db::QueryRows>> {
    let conn = state.pool.get_conn().await?;
    Ok(Json(dbc::db::list_schemas(&conn).await?.row_maps()))
}

#[poem::handler]
async fn get_tables(
    Data(state): Data<&Arc<dbc::State>>,
    Path(schema): Path<String>,
) -> eyre::Result<Json<dbc::db::QueryRows>> {
    let conn = state.pool.get_conn().await?;
    Ok(Json(dbc::db::list_tables(&conn, &schema).await?.row_maps()))
}

#[poem::handler]
async fn get_table_ddl(
    Data(state): Data<&Arc<dbc::State>>,
    Path(table_name): Path<String>,
) -> eyre::Result<Json<serde_json::Value>> {
    let conn = state.pool.get_conn().await?;
    let ddl = dbc::db::table_ddl(&conn, &table_name).await?;
    Ok(Json(serde_json::json!({ "ddl": ddl })))
}

#[derive(Deserialize)]
struct QueryParams {
    pub query: String,
    pub page: usize,
    pub page_size: usize,
}

#[poem::handler]
async fn handle_query(
    Data(state): Data<&Arc<dbc::State>>,
    Json(params): Json<QueryParams>,
) -> eyre::Result<Json<dbc::db::PaginatedQueryResult>> {
    let conn = state.pool.get_conn().await?;
    Ok(Json(
        dbc::db::paginated_query(&conn, &params.query, &[], params.page, params.page_size).await?,
    ))
}

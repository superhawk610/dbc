use poem::{EndpointExt, Route, Server, get, post};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{Mutex, RwLock};

#[tokio::main]
async fn main() -> eyre::Result<()> {
    // load environment variables
    #[cfg(not(feature = "bundle"))]
    dotenv::dotenv().ok();

    // fix $PATH when bundled
    #[cfg(feature = "bundle")]
    let _ = fix_path_env::fix();

    // initialize logger
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .with_test_writer()
        .init();

    // start up stream worker
    let worker = dbc::stream::StreamWorker::new();

    #[cfg(feature = "bundle")]
    let encryption_key = Some(dotenv_codegen::dotenv!("ENCRYPTION_KEY"));
    #[cfg(not(feature = "bundle"))]
    let encryption_key = std::env::var("ENCRYPTION_KEY").ok();

    // load encryption key
    if let Err(err) = dbc::persistence::load_encryption_key(encryption_key.as_deref()) {
        println!("{}", err);
        std::process::exit(1);
    };

    // initialize store and load default connection if none are present
    let mut store = dbc::persistence::Store::load().unwrap();
    dbg!(&store);
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
            password: Some(db_pass),
            password_file: None,
            database: db_database,
            ssl: false,
        };

        store.connections.push(connection);
        store.persist().unwrap();
    }

    let state = Arc::new(dbc::State {
        pools: Mutex::new(HashMap::new()),
        config: RwLock::new(store),
        worker: Mutex::new(worker),
    });

    use dbc::server::routes;
    let router = Route::new()
        .at("/:channel", get(routes::websocket))
        .at("/connections/:connection", get(routes::connection_info))
        .nest(
            "/db",
            Route::new()
                .at("/databases", get(routes::get_databases))
                .at("/schemas", get(routes::get_schemas))
                .at("/schemas/:schema/tables", get(routes::get_tables))
                .at(
                    "/schemas/:schema/tables/:table/columns",
                    get(routes::get_columns),
                )
                .at(
                    "/ddl/schemas/:schema/tables/:table",
                    get(routes::get_table_ddl),
                ),
        )
        .at(
            "/config",
            get(routes::get_config).put(routes::update_config),
        )
        .at("/query", post(routes::handle_query));

    #[cfg(debug_assertions)]
    let router = router.nest(
        "/debug",
        Route::new().at("/state", get(routes::debug::get_state)),
    );

    let router = router
        .with(poem::middleware::Cors::new())
        .with(poem::middleware::Tracing)
        .around(routes::format_eyre)
        .data(state);

    let server_port = if cfg!(feature = "bundle") {
        // when bundled, have the system assign us a port
        0
    } else {
        // otherwise, use the port specified in the config
        std::env::var("API_PORT")
            .expect("API_PORT is set")
            .parse::<usize>()
            .expect("API_PORT is valid")
    };

    let server_addr = format!("127.0.0.1:{server_port}");
    let (acceptor, _server_port) = dbc::server::bind_acceptor(&server_addr).await;

    // spawn the server in a background task
    let _server_handle = tokio::spawn(async move {
        Server::new_with_acceptor(acceptor)
            .run(router)
            .await
            .unwrap();
    });

    // if we're bundling, open the webview in the main thread
    #[cfg(feature = "bundle")]
    dbc::server::WebView::launch(_server_port).await;

    // otherwise, just block on the server task
    #[cfg(not(feature = "bundle"))]
    {
        _server_handle.await.unwrap();
        Ok(())
    }
}

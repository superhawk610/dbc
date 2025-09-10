use poem::{EndpointExt, Route, Server, get, post, put};
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
    dbc::stream::init();

    #[cfg(feature = "bundle")]
    let encryption_key = Some(dotenv_codegen::dotenv!("ENCRYPTION_KEY"));
    #[cfg(not(feature = "bundle"))]
    let encryption_key = std::env::var("ENCRYPTION_KEY").ok();

    // load encryption key
    if let Err(err) = dbc::persistence::load_encryption_key(encryption_key.as_deref()) {
        println!("{}", err);
        std::process::exit(1);
    };

    // load store
    let store = dbc::persistence::Store::load().unwrap();

    let state = Arc::new(dbc::State {
        pools: Mutex::new(HashMap::new()),
        config: RwLock::new(store),
    });

    use dbc::server::routes;
    let router = Route::new()
        .at("/:channel", get(routes::websocket))
        .nest(
            "/connections",
            Route::new()
                .at("/:connection", get(routes::connection_info))
                .at("/:connection/close", put(routes::close_connection))
                .at("/:connection/reload", put(routes::reload_connection)),
        )
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
                    "/ddl/schemas/:schema/table/:table",
                    get(routes::get_table_ddl),
                )
                .at("/ddl/schemas/:schema/view/:view", get(routes::get_view_ddl))
                .at(
                    "/ddl/schemas/:schema/materialized_view/:view",
                    get(routes::get_materialized_view_ddl),
                ),
        )
        .at(
            "/config",
            get(routes::get_config).put(routes::update_config),
        )
        .at("/query", post(routes::handle_query))
        .at("/prepare", post(routes::prepare_query));

    #[cfg(debug_assertions)]
    let router = router.nest(
        "/debug",
        Route::new().at("/state", get(routes::debug::get_state)),
    );

    let router = router
        .with(poem::middleware::Cors::new())
        .with(poem::middleware::Tracing)
        .around(routes::format_eyre)
        .data(Arc::clone(&state));

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
    dbc::server::WebView::launch(state, _server_port).await;

    // otherwise, just block on the server task
    #[cfg(not(feature = "bundle"))]
    {
        _server_handle.await.unwrap();
        Ok(())
    }
}

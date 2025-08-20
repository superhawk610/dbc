use poem::{
    EndpointExt, Route, Server,
    endpoint::StaticFilesEndpoint,
    put,
    web::{Data, Json},
};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use tokio::process::Command;
use wry::WebViewBuilder;

const VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct WebView;

impl WebView {
    pub async fn launch(server_port: u16) -> ! {
        // rehydrate localStorage, if it exists from a previous run
        let local_storage_file = crate::config_dir().join("localStorage.json");
        let local_storage = if local_storage_file.exists() {
            tokio::fs::read_to_string(&local_storage_file)
                .await
                .unwrap()
        } else {
            "{}".to_owned()
        };

        // build frontend bundle
        let asset_dir = crate::config_dir().join("build");
        if asset_dir.exists() {
            let _ = tokio::fs::remove_dir_all(&asset_dir).await;
        }

        // if we're running from within the MacOS bundle, look in the Resources dir
        // otherwise, we're running via `cargo run` and we're within the repository
        let working_dir = if let Ok(bin_path) = std::env::current_exe()
            && let Some(bin_dir) = bin_path.parent()
            && let Some(dir_name) = bin_dir.file_name()
            && let Some(dir_name) = dir_name.to_str()
            && dir_name == "MacOS"
        {
            bin_dir.join("../Resources/_up_/client")
        } else {
            std::path::PathBuf::from("../client")
        };

        Command::new("deno")
            .current_dir(working_dir)
            .args(&["task", "build", "--outDir", asset_dir.to_str().unwrap()])
            .env("VITE_API_BASE", format!("localhost:{}", server_port))
            .env("VITE_LOCAL_STORAGE", local_storage)
            .env(
                "VITE_SHOW_LOGS",
                if cfg!(debug_assertions) { "1" } else { "" },
            )
            .env("NODE_ENV", "production")
            .spawn()
            .unwrap()
            .wait()
            .await
            .unwrap();

        // serve frontend bundle
        let (acceptor, asset_port) = crate::server::bind_acceptor("127.0.0.1:0").await;

        #[poem::handler]
        async fn update_local_storage(
            Json(state): Json<serde_json::Value>,
            Data(local_storage_file): Data<&std::path::PathBuf>,
        ) -> poem::http::StatusCode {
            tokio::fs::write(
                &local_storage_file,
                serde_json::to_string_pretty(&state).unwrap(),
            )
            .await
            .unwrap();

            poem::http::StatusCode::NO_CONTENT
        }

        tokio::spawn(async move {
            let router = Route::new()
                .at("/_wry/localStorage", put(update_local_storage))
                .nest(
                    "/",
                    StaticFilesEndpoint::new(&asset_dir).index_file("index.html"),
                )
                .data(local_storage_file);

            Server::new_with_acceptor(acceptor)
                .run(router)
                .await
                .unwrap();
        });

        let _menu = if cfg!(target_os = "macos") {
            use muda::{AboutMetadataBuilder, Menu, PredefinedMenuItem, Submenu};

            let menu = Menu::with_items(&[
                &Submenu::with_items(
                    "App",
                    true,
                    &[
                        &PredefinedMenuItem::about(
                            Some("About dbc"),
                            Some(
                                AboutMetadataBuilder::new()
                                    .name(Some("dbc"))
                                    .version(Some(VERSION))
                                    .comments(Some("A database client."))
                                    .copyright(Some("© 2025 Aaron Ross. All rights reserved."))
                                    .build(),
                            ),
                        ),
                        // &PredefinedMenuItem::separator(),
                        // &PredefinedMenuItem::services(None),
                        // &PredefinedMenuItem::separator(),
                        // &PredefinedMenuItem::hide(None),
                        // &PredefinedMenuItem::hide_others(None),
                        // &PredefinedMenuItem::show_all(None),
                        &PredefinedMenuItem::separator(),
                        &PredefinedMenuItem::quit(None),
                    ],
                )
                .unwrap(),
                &Submenu::with_items("File", true, &[&PredefinedMenuItem::close_window(None)])
                    .unwrap(),
                &Submenu::with_items(
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(None),
                        &PredefinedMenuItem::redo(None),
                        &PredefinedMenuItem::separator(),
                        &PredefinedMenuItem::cut(None),
                        &PredefinedMenuItem::copy(None),
                        &PredefinedMenuItem::paste(None),
                        &PredefinedMenuItem::select_all(None),
                    ],
                )
                .unwrap(),
            ])
            .unwrap();

            menu.init_for_nsapp();

            Some(menu)
        } else {
            None
        };

        #[derive(Debug)]
        enum UserEvent {
            MenuEvent(muda::MenuEvent),
        }

        let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();

        let proxy = event_loop.create_proxy();
        muda::MenuEvent::set_event_handler(Some(move |event| {
            proxy.send_event(UserEvent::MenuEvent(event)).unwrap();
        }));

        let window = WindowBuilder::new()
            .with_title("dbc")
            .with_inner_size(LogicalSize::new(1100, 700))
            .build(&event_loop)
            .unwrap();

        let _webview = WebViewBuilder::new()
            .with_url(format!("http://localhost:{asset_port}"))
            .build(&window)
            .unwrap();

        event_loop.run(move |event, _, control_flow| {
            *control_flow = ControlFlow::Wait;

            match event {
                Event::WindowEvent {
                    event: WindowEvent::CloseRequested,
                    ..
                } => *control_flow = ControlFlow::Exit,

                Event::UserEvent(UserEvent::MenuEvent(ev)) => {
                    dbg!(&ev);
                }

                _ => {}
            }
        });
    }
}

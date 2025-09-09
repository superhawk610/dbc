use poem::{EndpointExt, Route, Server, endpoint::StaticFilesEndpoint};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tao::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    platform::macos::WindowBuilderExtMacOS,
    window::WindowBuilder,
};
use wry::WebViewBuilder;

const VERSION: &str = env!("CARGO_PKG_VERSION");

// these will be included in the build and replaced at runtime
pub const VITE_API_BASE: &str = "{{VITE_API_BASE}}";
pub const VITE_LOCAL_STORAGE: &str = "{{VITE_LOCAL_STORAGE}}";
pub const VITE_SHOW_LOGS: &str = "{{VITE_SHOW_LOGS}}";
pub const VITE_BUILD_VERSION: &str = "{{VITE_BUILD_VERSION}}";

pub struct WebView;

impl WebView {
    pub async fn launch(state: Arc<crate::State>, server_port: u16) -> ! {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();

        // rehydrate localStorage, if it exists from a previous run
        let local_storage_file = crate::config_dir().join("localStorage.json");
        let local_storage = if local_storage_file.exists() {
            tokio::fs::read_to_string(&local_storage_file)
                .await
                .unwrap()
        } else {
            "{}".to_owned()
        };

        let asset_dir = crate::asset_dir();

        // copy `index.template.js` template and replace with runtime variables
        let js_dir = asset_dir.join("assets");
        let js_index_template = js_dir.join("index.template.js");
        let js_index = index_js_file(&js_dir);

        let index = std::fs::read_to_string(&js_index_template).unwrap();
        let index = index
            .replace(VITE_BUILD_VERSION, &format!("{}", timestamp))
            .replace(VITE_API_BASE, &format!("localhost:{}", server_port))
            .replace(
                VITE_LOCAL_STORAGE,
                // re-escape JSON string since it will be inside a `JSON.parse("..")`
                &format!("{}", local_storage.escape_default()),
            )
            .replace(
                VITE_SHOW_LOGS,
                if cfg!(debug_assertions) { "1" } else { "" },
            );

        std::fs::write(&js_index, index).unwrap();

        // serve frontend bundle
        let (acceptor, asset_port) = crate::server::bind_acceptor("127.0.0.1:0").await;

        {
            let local_storage_file = local_storage_file.clone();
            tokio::spawn(async move {
                let router = Route::new()
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
        }

        #[cfg(target_os = "macos")]
        let _menu = build_menu();

        #[derive(Debug)]
        enum UserEvent {
            MenuEvent(muda::MenuEvent),
            IPCEvent(String),
        }

        let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();

        let proxy = event_loop.create_proxy();
        muda::MenuEvent::set_event_handler(Some(move |event| {
            proxy.send_event(UserEvent::MenuEvent(event)).unwrap();
        }));

        let config = state.config.read().await;
        let window_state = config.window.clone();
        drop(config);

        let mut window_builder = WindowBuilder::new()
            .with_title("dbc")
            .with_inner_size(window_state.size)
            .with_title_hidden(true)
            .with_titlebar_transparent(true)
            .with_fullsize_content_view(true);

        if let Some(position) = window_state.position {
            window_builder = window_builder.with_position(position);
        }

        let window = window_builder.build(&event_loop).unwrap();
        let scale_factor = window.scale_factor();

        let webview = WebViewBuilder::new()
            .with_url(format!("http://localhost:{asset_port}"))
            .with_devtools(true)
            .with_ipc_handler({
                let proxy = event_loop.create_proxy();
                move |req: wry::http::Request<String>| {
                    let msg = req.into_body();
                    proxy.send_event(UserEvent::IPCEvent(msg)).unwrap();
                }
            })
            .build(&window)
            .unwrap();

        // spawn a worker task to persist window position/size with debounce
        #[derive(Debug)]
        enum WindowUpdate {
            Position(dpi::LogicalPosition<u32>),
            Size(dpi::LogicalSize<u32>),
        }

        let (tx, rx) = std::sync::mpsc::channel::<WindowUpdate>();
        tokio::spawn(async move {
            #[derive(Debug)]
            enum Action {
                Close,
                Persist,
                Update(WindowUpdate),
            }

            let timeout = std::time::Duration::from_millis(500);
            let mut window_state = window_state;
            let mut dirty = false;

            loop {
                // only debounce if we have a pending write to avoid spinning
                // through the `Err` branch when nothing is happening
                let action = if dirty {
                    match rx.recv_timeout(timeout) {
                        Ok(msg) => Action::Update(msg),
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Action::Persist,
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Action::Close,
                    }
                } else {
                    match rx.recv() {
                        Ok(msg) => Action::Update(msg),
                        Err(_) => Action::Close,
                    }
                };

                match action {
                    Action::Close => break,

                    Action::Update(update) => {
                        match update {
                            WindowUpdate::Position(pos) => window_state.position = Some(pos),
                            WindowUpdate::Size(size) => window_state.size = size,
                        }

                        dirty = true;
                    }

                    Action::Persist => {
                        if dirty {
                            let mut config = state.config.write().await;
                            config.window.position = window_state.position;
                            config.window.size = window_state.size;
                            config.persist().unwrap();

                            dirty = false;
                        }
                    }
                }
            }
        });

        event_loop.run(move |event, _, control_flow| {
            *control_flow = ControlFlow::Wait;

            match event {
                Event::WindowEvent {
                    event: WindowEvent::CloseRequested,
                    ..
                } => *control_flow = ControlFlow::Exit,

                Event::WindowEvent {
                    event: WindowEvent::Resized(size),
                    ..
                } => {
                    let _ = tx.send(WindowUpdate::Size(dpi::LogicalSize::from_physical(
                        size,
                        scale_factor,
                    )));
                }

                Event::WindowEvent {
                    event: WindowEvent::Moved(position),
                    ..
                } => {
                    let _ = tx.send(WindowUpdate::Position(dpi::LogicalPosition::from_physical(
                        position,
                        scale_factor,
                    )));
                }

                Event::UserEvent(UserEvent::MenuEvent(ev)) => match ev.id.0.as_str() {
                    cmd @ ("settings" | "new-tab" | "toggle-results") => {
                        if let Err(err) =
                            webview.evaluate_script(&format!("window.__wry__('{cmd}')"))
                        {
                            eprintln!("Failed to open settings: {err}");
                        }
                    }
                    "toggle-devtools" => webview.open_devtools(),
                    id => {
                        eprintln!("unhandled menu event: {}", id);
                    }
                },

                Event::UserEvent(UserEvent::IPCEvent(msg)) => match msg.as_str() {
                    "drag-start" => {
                        window.drag_window().unwrap();
                    }

                    s if s.starts_with("local-storage:") => {
                        // round-trip to get pretty formatting before saving
                        let json = s.strip_prefix("local-storage:").unwrap();
                        let json = serde_json::from_str::<serde_json::Value>(json).unwrap();
                        let json = serde_json::to_string_pretty(&json).unwrap();
                        std::fs::write(&local_storage_file, json).unwrap();
                    }

                    msg => {
                        eprintln!("unhandled ipc event: {}", msg);
                    }
                },

                _ => {}
            }
        });
    }
}

/// Given the path to the build's `assets` directory, find the `index-{HASH}.js` file.
pub fn index_js_file(js_dir: impl AsRef<std::path::Path>) -> std::path::PathBuf {
    std::fs::read_dir(js_dir.as_ref())
        .expect("populated during build")
        .map(|f| f.unwrap())
        .find(|f| {
            let name = f.file_name();
            let name = name.to_str().unwrap();
            name.starts_with("index-") && name.ends_with(".js")
        })
        .map(|f| js_dir.as_ref().join(f.file_name()))
        .expect("assets/index-{HASH}.js exists")
}

#[cfg(target_os = "macos")]
fn build_menu() -> muda::Menu {
    use muda::{
        AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu,
        accelerator::{Accelerator, Code, Modifiers},
    };

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
                &PredefinedMenuItem::separator(),
                &MenuItem::with_id(
                    "settings",
                    "Settings",
                    true,
                    Some(Accelerator::new(Some(Modifiers::SUPER), Code::Comma)),
                ),
                &PredefinedMenuItem::separator(),
                &PredefinedMenuItem::quit(None),
            ],
        )
        .unwrap(),
        &Submenu::with_items(
            "File",
            true,
            &[
                &MenuItem::with_id(
                    "new-tab",
                    "New Tab",
                    true,
                    Some(Accelerator::new(Some(Modifiers::SUPER), Code::KeyT)),
                ),
                &PredefinedMenuItem::separator(),
                &PredefinedMenuItem::close_window(None),
            ],
        )
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
        &Submenu::with_items(
            "View",
            true,
            &[&MenuItem::with_id(
                "toggle-results",
                "Toggle Query Results",
                true,
                None,
            )],
        )
        .unwrap(),
        #[cfg(feature = "devtools")]
        &Submenu::with_items(
            "Developer",
            true,
            &[&MenuItem::with_id(
                "toggle-devtools",
                "Toggle DevTools",
                true,
                Some(Accelerator::new(
                    Some(Modifiers::SUPER | Modifiers::ALT),
                    Code::KeyI,
                )),
            )],
        )
        .unwrap(),
    ])
    .unwrap();

    menu.init_for_nsapp();

    menu
}

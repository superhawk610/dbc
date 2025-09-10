#!/usr/bin/env cargo +nightly -Z script

---
[package]
edition = "2024"

[dependencies]
clap = { version = "4.5.45", features = ["derive"] }
dbc = { path = "./server", features = ["bundle"] }
---

use clap::Parser;
use dbc::server::webview;
use std::path::PathBuf;
use std::process::Command;

/// Build `dbc` into an executable bundle.
#[derive(Parser, Debug)]
#[command(about, long_about = None)]
struct Args {
    /// Build and run in development mode.
    #[arg(long, group = "mode")]
    dev: bool,

    /// Build for release and copy into the system Applications directory.
    #[arg(long, group = "mode")]
    install: bool,
}

fn main() {
    let args = Args::parse();
    let target = if args.dev { "debug" } else { "release" };
    let should_install = args.install || !args.dev;

    // initialize build directory
    let asset_dir = dbc::asset_dir_in(
        &PathBuf::from(format!("./server/target/{target}/"))
            .canonicalize()
            .unwrap(),
    );
    step(&format!(
        "Initializing build directory at {}",
        asset_dir.display()
    ));
    if asset_dir.exists() {
        let _ = std::fs::remove_dir_all(&asset_dir);
    } else {
        std::fs::create_dir_all(&asset_dir).unwrap();
    }

    // build FE bundle
    step("Running FE bundle setup");
    exec_in("./client", "./build.sh");

    step("Building FE bundle");
    Command::new("deno")
        .current_dir("./client")
        .args(&["task", "build", "--outDir", asset_dir.to_str().unwrap()])
        .env("NODE_ENV", "production")
        .env("VITE_BUNDLED", "1")
        .env("VITE_BUILD_VERSION", webview::VITE_BUILD_VERSION)
        .env("VITE_API_BASE", webview::VITE_API_BASE)
        .env("VITE_LOCAL_STORAGE", webview::VITE_LOCAL_STORAGE)
        .env("VITE_SHOW_LOGS", webview::VITE_SHOW_LOGS)
        .spawn()
        .unwrap()
        .wait()
        .unwrap();

    // copy index-{HASH}.js to index.template.js
    // runtime values will be interpolated immediately before launching
    step("Copying assets/index-{HASH}.js to assets/index.template.js");
    let js_dir = asset_dir.join("assets");
    let js_index = webview::index_js_file(&js_dir);

    std::fs::copy(&js_index, js_dir.join("index.template.js")).unwrap();

    if should_install {
        // build with `cargo-bundle`
        step("Building application bundle");
        exec_in(
            "./server",
            "cargo bundle --release --features bundle,devtools",
        );

        // copy FE assets to bundle
        step("Copying FE assets to bundle");
        exec_in(
            "./server",
            &format!(
                "cp -r {} ./target/release/bundle/osx/dbc.app/Contents/Resources/",
                asset_dir.display()
            ),
        );

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        std::fs::write(
            "./server/target/release/bundle/osx/dbc.app/Contents/Resources/assets/.timestamp",
            format!("{}", timestamp),
        )
        .unwrap();

        // copy to system applications dir
        done("Built successfully");
        step("Installing");
        exec("cp -r ./server/target/release/bundle/osx/dbc.app /Applications");

        done("Installed to /Applications/dbc.app");
    } else {
        step("Running application");
        exec_in("./server", "cargo run --features bundle");
    }
}

fn step(desc: &str) {
    println!("⚡️ {desc}...")
}

fn done(desc: &str) {
    println!("✅ Done! {desc}")
}

fn exec(sh: &str) {
    exec_in(".", sh)
}

fn exec_in(cwd: &str, cmd: &str) {
    let (bin, args) = cmd.split_once(' ').unwrap_or((cmd, ""));

    Command::new(bin)
        .current_dir(cwd)
        .args(args.split(' '))
        .spawn()
        .unwrap()
        .wait()
        .unwrap();
}

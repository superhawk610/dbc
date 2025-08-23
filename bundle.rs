#!/usr/bin/env cargo +nightly -Z script

---
[package]
edition = "2024"

[dependencies]
dbc = { path = "./server", features = ["bundle"] }
---

use dbc::server::webview;
use std::process::Command;

fn main() {
    // initialize build directory
    let asset_dir = dbc::config_dir().join("build");
    step(&format!(
        "Initializing build directory at {}",
        asset_dir.display()
    ));
    if asset_dir.exists() {
        let _ = std::fs::remove_dir_all(&asset_dir);
    }

    // build FE bundle
    step("Building FE bundle");
    Command::new("deno")
        .current_dir("./client")
        .args(&["task", "build", "--outDir", asset_dir.to_str().unwrap()])
        .env("NODE_ENV", "production")
        .env("VITE_BUNDLED", "1")
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

    // build with `cargo-bundle`
    step("Building application bundle");
    exec_in(
        "./server",
        "cargo bundle --release --features bundle,devtools",
    );

    // copy to system applications dir
    done("Built successfully");
    step("Installing");
    exec("cp -r ./server/target/release/bundle/osx/dbc.app /Applications");

    done("Installed to /Applications/dbc.app");
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
    let (bin, args) = cmd.split_once(' ').unwrap();

    Command::new(bin)
        .current_dir(cwd)
        .args(args.split(' '))
        .spawn()
        .unwrap()
        .wait()
        .unwrap();
}

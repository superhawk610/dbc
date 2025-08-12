pub mod routes;
use poem::listener::{Acceptor, Listener, TcpAcceptor, TcpListener};

#[cfg(feature = "bundle")]
pub mod webview;
#[cfg(feature = "bundle")]
pub use webview::WebView;

pub async fn bind_acceptor(addr: &str) -> (TcpAcceptor, u16) {
    let acceptor = TcpListener::bind(addr)
        .into_acceptor()
        .await
        .expect("valid server host/port");
    let server_port = acceptor.local_addr()[0].as_socket_addr().unwrap().port();
    (acceptor, server_port)
}

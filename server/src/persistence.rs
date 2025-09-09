use aes_gcm::{
    Aes256Gcm, Key,
    aead::{Aead, AeadCore, KeyInit, OsRng},
};
use dpi::{LogicalPosition, LogicalSize};
use serde::{Deserialize, Serialize};
use std::os::unix::process::ExitStatusExt;
use std::sync::OnceLock;
use tokio::io::AsyncReadExt;

const STORE_FILE: &str = "store.toml";

static ENCRYPTION_KEY: OnceLock<Key<Aes256Gcm>> = OnceLock::new();

pub fn load_encryption_key(key_str: Option<&str>) -> eyre::Result<()> {
    let Some(key_str) = key_str else {
        eyre::bail!(
            "ENCRYPTION_KEY environment variable is not set\nhere's a key you can use: \"{:x}\"",
            Aes256Gcm::generate_key(OsRng)
        );
    };

    let key: Result<[u8; 32], _> = hex::decode(&key_str)?.try_into();
    let Ok(key) = key else {
        eyre::bail!(
            "{} is not a valid encryption key\nhere's a key you can use instead: \"{:x}\"",
            key_str,
            Aes256Gcm::generate_key(OsRng)
        );
    };

    ENCRYPTION_KEY.set(key.into()).unwrap();

    Ok(())
}

fn encryption_key() -> &'static Key<Aes256Gcm> {
    ENCRYPTION_KEY.get().unwrap()
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct Store {
    #[serde(default)]
    pub connections: Vec<Connection>,
    #[serde(default)]
    pub window: WindowState,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowState {
    pub size: LogicalSize<u32>,
    pub position: Option<LogicalPosition<u32>>,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            size: LogicalSize::new(1400, 900),
            // `None` will use the platform-specific default, which is
            // somewhere close to the middle of the display on macOS
            position: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Connection {
    pub name: String,
    pub host: String,
    pub port: usize,
    pub username: String,
    /// The plain-text password to use when connecting.
    pub password: Option<String>,
    /// A path to an executable file to run to generate the password to use when connecting.
    /// Any text printed to `stdout` by this executable will be included.
    pub password_file: Option<String>,
    pub database: String,
    #[serde(default)]
    pub ssl: bool,
}

impl Connection {
    /// If `password_file` is set, runs the given executable and places the output
    /// in `password`. If a password is already set (or if this function has already
    /// been run before), does nothing.
    ///
    /// # Panics
    ///
    /// Panics if neither `password` nor `password_file` is set.
    pub async fn load_password(&mut self) -> eyre::Result<()> {
        if let Some(bin) = self.password_file() {
            crate::stream::broadcast(format!("Fetching password via \"{}\":", bin)).await;

            let bin = shellexpand::tilde(bin).to_string();
            let mut cmd = tokio::process::Command::new(bin)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                // if the command times out, kill it
                .kill_on_drop(true)
                .spawn()
                .expect("valid executable file");

            let mut stdout = cmd.stdout.take().unwrap();
            let mut stderr = cmd.stderr.take().unwrap();

            let (stdout_tx, stdout_rx) = tokio::sync::oneshot::channel::<String>();

            // collect stdout and send it once complete
            tokio::spawn(async move {
                let mut buf = String::new();
                stdout.read_to_string(&mut buf).await.expect("valid utf-8");
                let _ = stdout_tx.send(buf);
            });

            // collect stderr and broadcast line-by-line as its received
            tokio::spawn(async move {
                let mut buf = [0; 2048];
                while let Ok(n) = stderr.read(&mut buf).await {
                    let line = String::from_utf8_lossy(&buf[..n]);
                    crate::stream::broadcast(line).await;
                }
            });

            let timeout = std::time::Duration::from_secs(10);
            let status = match tokio::time::timeout(timeout, cmd.wait()).await {
                Err(_) => eyre::bail!("Timeout after {}s", timeout.as_secs()),
                Ok(Err(err)) => eyre::bail!("Failed to execute:\n{err}"),
                Ok(Ok(output)) => output,
            };

            let stdout = stdout_rx.await.unwrap();

            if !status.success() {
                eyre::bail!(
                    "exited with {}",
                    status
                        .code()
                        .map(|c| format!("code {c}\n"))
                        .or(status.signal().map(|s| format!("signal {s}\n")))
                        .expect("process should have exited with a code or signal")
                );
            }

            self.password = Some(stdout.trim().to_owned());
        } else if self.password.is_none() {
            panic!(
                "{}: either `password` or `password_file` must be set",
                self.name
            );
        }

        Ok(())
    }

    pub fn password_file(&self) -> Option<&String> {
        self.password_file.as_ref().filter(|s| !s.is_empty())
    }
}

impl From<&Connection> for crate::db::Config {
    fn from(conn: &Connection) -> Self {
        let password = conn
            .password
            .as_ref()
            .expect("`load_password` has been called");

        crate::db::Config::builder()
            .host(conn.host.clone())
            .port(conn.port)
            .username(conn.username.clone())
            .password(password.clone())
            .database(conn.database.clone())
            .ssl(conn.ssl)
            .build()
    }
}

impl Store {
    pub fn load() -> eyre::Result<Self> {
        match std::fs::read_to_string(crate::config_dir().join(STORE_FILE)) {
            Ok(toml_str) => {
                let mut store: Self = toml::from_str(&toml_str)?;

                // decrypt passwords
                for conn in store.connections.iter_mut() {
                    if let Some(p) = conn.password.as_mut() {
                        *p = EncryptedString::load(&p).expect("valid encoded string").0;
                    }
                }

                Ok(store)
            }
            Err(_) => {
                tracing::info!("could not find store, creating new...");
                let store = Store::default();
                store.persist()?;
                Ok(store)
            }
        }
    }

    pub fn persist(&self) -> eyre::Result<()> {
        // encrypt passwords
        let mut this = self.clone();
        for conn in this.connections.iter_mut() {
            if let Some(p) = conn.password.as_mut() {
                *p = EncryptedString(p.clone()).dump();
            }
        }

        let toml_str = toml::to_string_pretty(&this)?;
        std::fs::write(crate::config_dir().join(STORE_FILE), toml_str.as_bytes())?;
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct EncryptedString(String);

impl EncryptedString {
    pub fn new<S>(str: S) -> Self
    where
        S: Into<String>,
    {
        Self(str.into())
    }

    pub fn dump(&self) -> String {
        let cipher = Aes256Gcm::new(encryption_key());
        let nonce = Aes256Gcm::generate_nonce(OsRng);
        let encrypted = cipher
            .encrypt(&nonce, self.0.as_bytes())
            .expect("encryption works on utf-8 string");
        format!("{:02x}:{}", nonce, hex::encode(&encrypted))
    }

    pub fn load(str: &str) -> eyre::Result<Self> {
        // first 12 bytes are the nonce
        let (nonce_str, encrypted_str) = str
            .split_once(':')
            .ok_or(eyre::eyre!("not a valid encrypted string"))?;
        let nonce: [u8; 12] = hex::decode(nonce_str)?
            .try_into()
            .map_err(|_| eyre::eyre!("invalid nonce"))?;
        let encrypted = hex::decode(encrypted_str)?;
        let cipher = Aes256Gcm::new(encryption_key());
        let plaintext = cipher
            .decrypt(&nonce.into(), encrypted.as_ref())
            .map_err(|_| eyre::eyre!("unable to decode"))?;
        Ok(Self(String::from_utf8(plaintext)?))
    }
}

impl std::ops::Deref for EncryptedString {
    type Target = String;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Serialize for EncryptedString {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.dump())
    }
}

impl<'de> Deserialize<'de> for EncryptedString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct Visitor;

        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = EncryptedString;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("an encrypted string")
            }

            fn visit_string<E>(self, str: String) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(EncryptedString::load(&str).map_err(|err| E::custom(format!("{}", err)))?)
            }
        }

        deserializer.deserialize_str(Visitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encyption_roundtrips() {
        let key = Aes256Gcm::generate_key(OsRng);
        load_encryption_key(Some(&hex::encode(key))).unwrap();

        let plaintext = "hello, world!";
        let encrypted = dbg!(EncryptedString(plaintext.to_owned()).dump());
        assert_eq!(*EncryptedString::load(&encrypted).unwrap(), plaintext);
    }
}

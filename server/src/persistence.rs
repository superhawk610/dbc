use aes_gcm::{
    Aes256Gcm, Key,
    aead::{Aead, AeadCore, KeyInit, OsRng},
};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

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

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Store {
    pub connections: Vec<Connection>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Connection {
    pub name: String,
    pub host: String,
    pub port: usize,
    pub username: String,
    pub password: EncryptedString,
    pub database: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DecryptedConnection {
    pub name: String,
    pub host: String,
    pub port: usize,
    pub username: String,
    pub password: String,
    pub database: String,
}

impl From<&Connection> for DecryptedConnection {
    fn from(conn: &Connection) -> Self {
        Self {
            name: conn.name.clone(),
            host: conn.host.clone(),
            port: conn.port,
            username: conn.username.clone(),
            password: conn.password.0.clone(),
            database: conn.database.clone(),
        }
    }
}

impl Store {
    pub fn load() -> eyre::Result<Self> {
        match std::fs::read_to_string(STORE_FILE) {
            Ok(toml_str) => Ok(toml::from_str(&toml_str)?),
            Err(_) => {
                tracing::info!("could not find store, creating new...");
                let store = Store::default();
                store.persist()?;
                Ok(store)
            }
        }
    }

    pub fn persist(&self) -> eyre::Result<()> {
        let toml_str = toml::to_string_pretty(self)?;
        std::fs::write(STORE_FILE, toml_str.as_bytes())?;
        Ok(())
    }
}

#[derive(Debug)]
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

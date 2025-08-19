use poem::web::headers::{Header, HeaderName, HeaderValue};
use std::ops::Deref;

pub struct XConnName(String);

static X_CONN_NAME: HeaderName = HeaderName::from_static("x-conn-name");

impl Header for XConnName {
    fn name() -> &'static HeaderName {
        &X_CONN_NAME
    }

    fn decode<'i, I>(values: &mut I) -> Result<Self, poem::web::headers::Error>
    where
        Self: Sized,
        I: Iterator<Item = &'i HeaderValue>,
    {
        Ok(Self(
            values
                .next()
                .ok_or(poem::web::headers::Error::invalid())?
                .to_str()
                .map_err(|_| poem::web::headers::Error::invalid())?
                .to_owned(),
        ))
    }

    fn encode<E: Extend<HeaderValue>>(&self, _values: &mut E) {
        panic!("not implemented")
    }
}

impl From<XConnName> for String {
    fn from(value: XConnName) -> Self {
        value.0
    }
}

impl Deref for XConnName {
    type Target = String;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

pub struct XDatabase(String);

static X_DATABASE: HeaderName = HeaderName::from_static("x-database");

impl Header for XDatabase {
    fn name() -> &'static HeaderName {
        &X_DATABASE
    }

    fn decode<'i, I>(values: &mut I) -> Result<Self, poem::web::headers::Error>
    where
        Self: Sized,
        I: Iterator<Item = &'i HeaderValue>,
    {
        Ok(Self(
            values
                .next()
                .ok_or(poem::web::headers::Error::invalid())?
                .to_str()
                .map_err(|_| poem::web::headers::Error::invalid())?
                .to_owned(),
        ))
    }

    fn encode<E: Extend<HeaderValue>>(&self, _values: &mut E) {
        panic!("not implemented")
    }
}

impl From<XDatabase> for String {
    fn from(value: XDatabase) -> Self {
        value.0
    }
}

impl Deref for XDatabase {
    type Target = String;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

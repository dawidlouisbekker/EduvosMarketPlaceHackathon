use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use prost::Message;

use crate::api::proto::PROTOBUF;
use crate::pb;

pub type AppResult<T> = Result<T, AppError>;

/// Error response. The body is an `incubator.v1.Error` protobuf message (see docs/adr/0001-protobuf-api-contracts.md).
#[derive(Debug)]
pub struct AppError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl AppError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self { status, code, message: message.into() }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    pub fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", "sign in required")
    }

    pub fn forbidden() -> Self {
        Self::new(StatusCode::FORBIDDEN, "forbidden", "you do not have access to this resource")
    }

    pub fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", "resource not found")
    }

    pub fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, code, message)
    }

    pub fn internal(err: impl std::fmt::Display) -> Self {
        tracing::error!("internal error: {err}");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", "internal server error")
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let body = pb::Error { code: self.code.to_owned(), message: self.message }.encode_to_vec();
        (self.status, [(header::CONTENT_TYPE, PROTOBUF)], body).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        match &err {
            sqlx::Error::RowNotFound => Self::not_found(),
            sqlx::Error::Database(db) if db.is_unique_violation() => {
                Self::conflict("already_exists", "a record with these details already exists")
            }
            sqlx::Error::Database(db) if db.is_foreign_key_violation() => {
                Self::bad_request("a referenced record does not exist")
            }
            _ => Self::internal(err),
        }
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        Self::internal(err)
    }
}

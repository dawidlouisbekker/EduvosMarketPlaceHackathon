//! Protobuf request/response bodies (`application/x-protobuf`).

use axum::body::Bytes;
use axum::extract::{FromRequest, Request};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use prost::Message;

use crate::error::{AppError, AppResult};

pub const PROTOBUF: &str = "application/x-protobuf";

/// Extractor: decodes the request body as `T`. An empty body decodes to `T::default()`.
/// Responder: encodes `T` as the response body.
pub struct Proto<T>(pub T);

impl<T, S> FromRequest<S> for Proto<T>
where
    T: Message + Default,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let content_type = req.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_owned);
        let body = Bytes::from_request(req, state)
            .await
            .map_err(|e| AppError::new(e.status(), "bad_request", e.body_text()))?;
        if body.is_empty() {
            return Ok(Proto(T::default()));
        }
        if content_type.as_deref().is_none_or(|ct| !ct.starts_with(PROTOBUF)) {
            return Err(AppError::new(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                format!("request body must be {PROTOBUF}"),
            ));
        }
        T::decode(body).map(Proto).map_err(|e| AppError::bad_request(format!("invalid protobuf body: {e}")))
    }
}

impl<T: Message> IntoResponse for Proto<T> {
    fn into_response(self) -> Response {
        ([(header::CONTENT_TYPE, PROTOBUF)], self.0.encode_to_vec()).into_response()
    }
}

pub type ProtoResult<T> = AppResult<Proto<T>>;

/// Wraps a response message.
pub fn ok<T>(message: T) -> ProtoResult<T> {
    Ok(Proto(message))
}

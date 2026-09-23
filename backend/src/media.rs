//! Image storage in S3-compatible object storage (MinIO).
//!
//! Clients POST the raw image bytes to the backend, which checks the file's magic bytes
//! before storing it. Images are served publicly (anonymous-read bucket) through the reverse
//! proxy at `/<bucket>/<key>` on the same origin, so only verified image types may ever land
//! in the bucket; accepting arbitrary uploads would allow stored XSS on our origin.

use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{StatusCode, header};
use axum::routing::{delete, post};
use axum::{Json, Router};
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use uuid::Uuid;

use crate::AppState;
use crate::auth::AuthUser;
use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::listings::{self, Image};
use crate::ventures::{self, require_member};

pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const MAX_IMAGES_PER_LISTING: i64 = 8;
const SIGN_TTL: Duration = Duration::from_secs(60);

pub struct Media {
    internal: Bucket,
    creds: Credentials,
    public_base: String,
}

impl Media {
    pub fn new(cfg: &Config) -> Result<Self, String> {
        let internal = Bucket::new(
            cfg.s3.internal_endpoint.clone(),
            UrlStyle::Path,
            cfg.s3.bucket.clone(),
            cfg.s3.region.clone(),
        )
        .map_err(|e| e.to_string())?;
        Ok(Self {
            internal,
            creds: Credentials::new(cfg.s3.access_key.clone(), cfg.s3.secret_key.clone()),
            public_base: format!("{}/{}", cfg.public_origin(), cfg.s3.bucket),
        })
    }

    pub fn public_url(&self, key: &str) -> String {
        format!("{}/{key}", self.public_base)
    }

    async fn put(&self, http: &reqwest::Client, key: &str, content_type: &str, body: Bytes) -> AppResult<()> {
        let url = self.internal.put_object(Some(&self.creds), key).sign(SIGN_TTL);
        http.put(url)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
            .body(body)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn delete(&self, http: &reqwest::Client, key: &str) -> AppResult<()> {
        let url = self.internal.delete_object(Some(&self.creds), key).sign(SIGN_TTL);
        http.delete(url).send().await?.error_for_status()?;
        Ok(())
    }
}

/// Identifies JPEG, PNG and WebP by their magic bytes. Returns (content type, extension).
fn sniff_image(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    match bytes {
        [0xFF, 0xD8, 0xFF, ..] => Some(("image/jpeg", "jpg")),
        [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, ..] => Some(("image/png", "png")),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some(("image/webp", "webp")),
        _ => None,
    }
}

fn check_image(body: &Bytes) -> AppResult<(&'static str, &'static str)> {
    if body.is_empty() {
        return Err(AppError::bad_request("empty upload"));
    }
    if body.len() > MAX_IMAGE_BYTES {
        return Err(AppError::new(StatusCode::PAYLOAD_TOO_LARGE, "too_large", "images must be 5 MB or smaller"));
    }
    sniff_image(body).ok_or_else(|| {
        AppError::new(StatusCode::UNSUPPORTED_MEDIA_TYPE, "unsupported_image", "only JPEG, PNG and WebP images are allowed")
    })
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/listings/{id}/images", post(upload_listing_image))
        .route("/listings/{id}/images/{image_id}", delete(delete_listing_image))
        .route("/ventures/{venture}/logo", post(upload_logo))
        .layer(DefaultBodyLimit::max(MAX_IMAGE_BYTES))
}

/// `POST /listings/{id}/images` with the raw image as the request body.
async fn upload_listing_image(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    body: Bytes,
) -> AppResult<(StatusCode, Json<Image>)> {
    let listing = listings::find(&state.db, id).await?;
    require_member(&state.db, listing.venture_id, &user).await?;
    let (content_type, ext) = check_image(&body)?;

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM listing_images WHERE listing_id = $1")
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    if count >= MAX_IMAGES_PER_LISTING {
        return Err(AppError::conflict("too_many_images", "a listing can have at most 8 images"));
    }

    let image_id = Uuid::now_v7();
    let key = format!("listings/{id}/{image_id}.{ext}");
    let size = body.len() as i64;
    state.media.put(&state.http, &key, content_type, body).await?;
    sqlx::query(
        "INSERT INTO listing_images (id, listing_id, object_key, content_type, size_bytes, position)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(image_id)
    .bind(id)
    .bind(&key)
    .bind(content_type)
    .bind(size)
    .bind(count as i32)
    .execute(&state.db)
    .await?;
    listings::mark_changed(&state.db, id).await?;

    Ok((StatusCode::CREATED, Json(Image { id: image_id, url: state.media.public_url(&key) })))
}

async fn delete_listing_image(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, image_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let listing = listings::find(&state.db, id).await?;
    require_member(&state.db, listing.venture_id, &user).await?;
    let key: String = sqlx::query_scalar("DELETE FROM listing_images WHERE id = $1 AND listing_id = $2 RETURNING object_key")
        .bind(image_id)
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    if let Err(e) = state.media.delete(&state.http, &key).await {
        tracing::warn!(key, "failed to delete image object: {}", e.message);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /ventures/{venture}/logo` with the raw image as the request body.
async fn upload_logo(
    State(state): State<AppState>,
    user: AuthUser,
    Path(key): Path<String>,
    body: Bytes,
) -> AppResult<Json<serde_json::Value>> {
    let venture = ventures::find(&state.db, &key).await?;
    require_member(&state.db, venture.id, &user).await?;
    let (content_type, ext) = check_image(&body)?;

    let object_key = format!("ventures/{}/logo-{}.{ext}", venture.id, Uuid::now_v7());
    state.media.put(&state.http, &object_key, content_type, body).await?;
    sqlx::query("UPDATE ventures SET logo_key = $2, updated_at = now() WHERE id = $1")
        .bind(venture.id)
        .bind(&object_key)
        .execute(&state.db)
        .await?;
    if let Some(old) = venture.logo_key {
        let _ = state.media.delete(&state.http, &old).await;
    }
    Ok(Json(serde_json::json!({ "logo_url": state.media.public_url(&object_key) })))
}

#[cfg(test)]
mod tests {
    use super::sniff_image;

    #[test]
    fn sniffs_images_and_rejects_html() {
        assert_eq!(sniff_image(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap().0, "image/jpeg");
        assert_eq!(sniff_image(b"\x89PNG\r\n\x1a\n....").unwrap().0, "image/png");
        assert_eq!(sniff_image(b"RIFF\0\0\0\0WEBPVP8 ").unwrap().0, "image/webp");
        assert!(sniff_image(b"<html><script>alert(1)</script>").is_none());
        assert!(sniff_image(b"").is_none());
    }
}

//! Opaque session tokens (cookie for web, bearer for the native app) and request extractors.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{Method, header};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::AppState;
use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::models::SessionKind;
use crate::util::{random_token, sha256};

const WEB_TTL: Duration = Duration::days(14);
const APP_TTL: Duration = Duration::days(30);

pub fn cookie_name(cfg: &Config) -> &'static str {
    // `__Host-` requires Secure, which browsers only honour over https.
    if cfg.secure_cookies() { "__Host-session" } else { "session" }
}

pub fn session_cookie(cfg: &Config, token: String, expires: OffsetDateTime) -> Cookie<'static> {
    Cookie::build((cookie_name(cfg), token))
        .path("/")
        .http_only(true)
        .secure(cfg.secure_cookies())
        .same_site(SameSite::Lax)
        .expires(expires)
        .build()
}

pub fn removal_cookie(cfg: &Config) -> Cookie<'static> {
    Cookie::build((cookie_name(cfg), "")).path("/").secure(cfg.secure_cookies()).build()
}

/// Creates a session and returns the raw token (only its hash is stored).
pub async fn create_session(
    db: &PgPool,
    user_id: Uuid,
    kind: SessionKind,
    user_agent: Option<&str>,
) -> AppResult<(String, OffsetDateTime)> {
    let token = random_token();
    let expires_at = OffsetDateTime::now_utc() + if kind == SessionKind::Web { WEB_TTL } else { APP_TTL };
    sqlx::query(
        "INSERT INTO sessions (id, token_hash, user_id, kind, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::now_v7())
    .bind(sha256(&token))
    .bind(user_id)
    .bind(kind)
    .bind(user_agent.map(|ua| ua.chars().take(256).collect::<String>()))
    .bind(expires_at)
    .execute(db)
    .await?;
    Ok((token, expires_at))
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub is_admin: bool,
    pub session_id: Uuid,
}

/// Signed-in user, if any. Invalid or expired tokens are treated as anonymous.
/// For routes that work for everyone but show more to signed-in users.
#[allow(dead_code)] // no route uses it yet
pub struct MaybeUser(pub Option<AuthUser>);

/// Signed-in user holding the Entra `Marketplace.Admin` app role.
#[allow(dead_code)] // no route uses it yet
pub struct AdminUser(pub AuthUser);

enum TokenSource {
    Cookie,
    Bearer,
}

fn extract_token(parts: &Parts, cfg: &Config) -> Option<(String, TokenSource)> {
    if let Some(token) = parts
        .headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        return Some((token.trim().to_owned(), TokenSource::Bearer));
    }
    CookieJar::from_headers(&parts.headers)
        .get(cookie_name(cfg))
        .map(|c| (c.value().to_owned(), TokenSource::Cookie))
}

/// Cookie-authenticated state-changing requests must come from our own origin (CSRF defence).
fn check_origin(parts: &Parts, cfg: &Config) -> AppResult<()> {
    if matches!(parts.method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return Ok(());
    }
    let origin = parts.headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    if origin == Some(cfg.public_origin().as_str()) {
        Ok(())
    } else {
        Err(AppError::new(axum::http::StatusCode::FORBIDDEN, "bad_origin", "cross-site request rejected"))
    }
}

async fn lookup(db: &PgPool, token: &str) -> AppResult<Option<AuthUser>> {
    let user = sqlx::query_as::<_, AuthUser>(
        "UPDATE sessions s
            SET last_seen_at = now()
           FROM users u
          WHERE s.token_hash = $1 AND s.expires_at > now() AND u.id = s.user_id
      RETURNING u.id, u.email, u.display_name, u.is_admin, s.id AS session_id",
    )
    .bind(sha256(token))
    .fetch_optional(db)
    .await?;
    Ok(user)
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let (token, source) = extract_token(parts, &state.cfg).ok_or_else(AppError::unauthorized)?;
        if matches!(source, TokenSource::Cookie) {
            check_origin(parts, &state.cfg)?;
        }
        lookup(&state.db, &token).await?.ok_or_else(AppError::unauthorized)
    }
}

impl FromRequestParts<AppState> for MaybeUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        match extract_token(parts, &state.cfg) {
            Some((token, _)) => Ok(MaybeUser(lookup(&state.db, &token).await?)),
            None => Ok(MaybeUser(None)),
        }
    }
}

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        if user.is_admin { Ok(AdminUser(user)) } else { Err(AppError::forbidden()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;

    fn cfg() -> Config {
        unsafe {
            for (k, v) in [
                ("DATABASE_URL", "postgres://x"),
                ("PUBLIC_BASE_URL", "https://market.example.com"),
                ("ENTRA_TENANT_ID", "t"),
                ("ENTRA_CLIENT_ID", "c"),
                ("ENTRA_CLIENT_SECRET", "s"),
            ] {
                std::env::set_var(k, v);
            }
        }
        Config::from_env().unwrap()
    }

    fn parts(method: Method, origin: Option<&str>) -> Parts {
        let mut b = Request::builder().method(method).uri("/api/x");
        if let Some(o) = origin {
            b = b.header(header::ORIGIN, o);
        }
        b.body(()).unwrap().into_parts().0
    }

    #[test]
    fn origin_check() {
        let cfg = cfg();
        assert!(check_origin(&parts(Method::GET, None), &cfg).is_ok());
        assert!(check_origin(&parts(Method::POST, Some("https://market.example.com")), &cfg).is_ok());
        assert!(check_origin(&parts(Method::POST, Some("https://evil.example.com")), &cfg).is_err());
        assert!(check_origin(&parts(Method::DELETE, None), &cfg).is_err());
    }
}

//! Sign-in endpoints.
//!
//! Web:    GET /auth/login[?prompt=none] -> Entra -> GET /auth/callback -> session cookie -> return_to
//! Native: GET /auth/login?client=app&redirect_uri=…&code_challenge=… -> Entra -> GET /auth/callback
//!         -> redirect_uri?code=<handoff> -> POST /auth/app/exchange {code, code_verifier} -> bearer token

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use super::oidc::AuthorizeRequest;
use super::session::{create_session, removal_cookie, session_cookie};
use super::AuthUser;
use crate::AppState;
use crate::error::{AppError, AppResult};
use crate::models::{MemberRole, SessionKind, VentureStatus};
use crate::util::{pkce_challenge, random_token, safe_return_to, sha256, with_query};

const LOGIN_TTL: Duration = Duration::minutes(10);
const HANDOFF_TTL: Duration = Duration::seconds(60);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/login", get(login))
        .route("/auth/callback", get(callback))
        .route("/auth/app/exchange", post(app_exchange))
        .route("/auth/logout", post(logout))
        .route("/me", get(me))
}

#[derive(Deserialize)]
struct LoginQuery {
    return_to: Option<String>,
    /// `none` for a silent single-sign-on attempt. Otherwise Microsoft's account picker is shown.
    prompt: Option<String>,
    /// `app` for the native app flow.
    client: Option<String>,
    redirect_uri: Option<String>,
    code_challenge: Option<String>,
}

async fn login(State(state): State<AppState>, Query(q): Query<LoginQuery>) -> AppResult<Redirect> {
    let (app_redirect_uri, app_code_challenge) = if q.client.as_deref() == Some("app") {
        let redirect = q
            .redirect_uri
            .filter(|r| state.cfg.app_redirect_uris.iter().any(|allowed| allowed == r))
            .ok_or_else(|| AppError::bad_request("redirect_uri is not registered"))?;
        let challenge = q
            .code_challenge
            .filter(|c| c.len() == 43 && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
            .ok_or_else(|| AppError::bad_request("code_challenge must be a base64url S256 challenge"))?;
        (Some(redirect), Some(challenge))
    } else {
        (None, None)
    };

    let silent = q.prompt.as_deref() == Some("none");
    let state_token = random_token();
    let nonce = random_token();
    let pkce_verifier = random_token();

    sqlx::query("DELETE FROM login_attempts WHERE expires_at < now()").execute(&state.db).await?;
    sqlx::query(
        "INSERT INTO login_attempts
            (state, nonce, pkce_verifier, silent, return_to, app_redirect_uri, app_code_challenge, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(&state_token)
    .bind(&nonce)
    .bind(&pkce_verifier)
    .bind(silent)
    .bind(safe_return_to(q.return_to.as_deref()))
    .bind(&app_redirect_uri)
    .bind(&app_code_challenge)
    .bind(OffsetDateTime::now_utc() + LOGIN_TTL)
    .execute(&state.db)
    .await?;

    let url = state
        .oidc
        .authorize_url(AuthorizeRequest {
            state: &state_token,
            nonce: &nonce,
            code_challenge: &pkce_challenge(&pkce_verifier),
            silent,
        })
        .await?;
    Ok(Redirect::to(&url))
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(sqlx::FromRow)]
struct LoginAttempt {
    nonce: String,
    pkce_verifier: String,
    silent: bool,
    return_to: String,
    app_redirect_uri: Option<String>,
    app_code_challenge: Option<String>,
    expires_at: OffsetDateTime,
}

async fn callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
    Query(q): Query<CallbackQuery>,
) -> AppResult<Response> {
    let state_token = q.state.ok_or_else(|| AppError::bad_request("missing state"))?;
    let attempt = sqlx::query_as::<_, LoginAttempt>(
        "DELETE FROM login_attempts WHERE state = $1
         RETURNING nonce, pkce_verifier, silent, return_to, app_redirect_uri, app_code_challenge, expires_at",
    )
    .bind(&state_token)
    .fetch_optional(&state.db)
    .await?
    .filter(|a| a.expires_at > OffsetDateTime::now_utc())
    .ok_or_else(|| AppError::bad_request("sign-in session expired, please try again"))?;

    // Entra reported an error (e.g. silent SSO found no session, or the user cancelled).
    if let Some(error) = q.error {
        let target = match (&attempt.app_redirect_uri, attempt.silent) {
            (Some(app), _) => with_query(app, "error", &error),
            (None, true) => with_query(&attempt.return_to, "sso", "unavailable"),
            (None, false) => with_query(&attempt.return_to, "auth_error", &error),
        };
        return Ok(Redirect::to(&target).into_response());
    }

    let code = q.code.ok_or_else(|| AppError::bad_request("missing code"))?;
    let claims = state.oidc.complete_login(&code, &attempt.pkce_verifier, &attempt.nonce).await?;
    let is_admin = claims.roles.iter().any(|r| r == &state.cfg.entra.admin_role);

    let user_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (id, entra_oid, tenant_id, email, display_name, is_admin)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (entra_oid) DO UPDATE
            SET email = EXCLUDED.email, display_name = EXCLUDED.display_name,
                is_admin = EXCLUDED.is_admin, last_login_at = now()
         RETURNING id",
    )
    .bind(Uuid::now_v7())
    .bind(claims.oid)
    .bind(claims.tid)
    .bind(claims.email())
    .bind(claims.display_name())
    .bind(is_admin)
    .fetch_one(&state.db)
    .await?;

    if let (Some(app_redirect), Some(challenge)) = (attempt.app_redirect_uri, attempt.app_code_challenge) {
        let handoff = random_token();
        sqlx::query("INSERT INTO app_handoffs (code_hash, user_id, code_challenge, expires_at) VALUES ($1, $2, $3, $4)")
            .bind(sha256(&handoff))
            .bind(user_id)
            .bind(challenge)
            .bind(OffsetDateTime::now_utc() + HANDOFF_TTL)
            .execute(&state.db)
            .await?;
        return Ok(Redirect::to(&with_query(&app_redirect, "code", &handoff)).into_response());
    }

    let user_agent = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok());
    let (token, expires) = create_session(&state.db, user_id, SessionKind::Web, user_agent).await?;
    let jar = jar.add(session_cookie(&state.cfg, token, expires));
    Ok((jar, Redirect::to(&attempt.return_to)).into_response())
}

#[derive(Deserialize)]
struct ExchangeBody {
    code: String,
    code_verifier: String,
}

#[derive(Serialize)]
struct ExchangeResponse {
    token: String,
    #[serde(with = "time::serde::rfc3339")]
    expires_at: OffsetDateTime,
}

#[derive(sqlx::FromRow)]
struct Handoff {
    user_id: Uuid,
    code_challenge: String,
    expires_at: OffsetDateTime,
}

async fn app_exchange(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ExchangeBody>,
) -> AppResult<Json<ExchangeResponse>> {
    let invalid = || AppError::new(StatusCode::BAD_REQUEST, "invalid_grant", "code is invalid or expired");
    let handoff = sqlx::query_as::<_, Handoff>(
        "DELETE FROM app_handoffs WHERE code_hash = $1 RETURNING user_id, code_challenge, expires_at",
    )
    .bind(sha256(&body.code))
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(invalid)?;
    if handoff.expires_at < OffsetDateTime::now_utc() || pkce_challenge(&body.code_verifier) != handoff.code_challenge {
        return Err(invalid());
    }
    let user_agent = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok());
    let (token, expires_at) = create_session(&state.db, handoff.user_id, SessionKind::App, user_agent).await?;
    Ok(Json(ExchangeResponse { token, expires_at }))
}

async fn logout(State(state): State<AppState>, user: AuthUser, jar: CookieJar) -> AppResult<impl IntoResponse> {
    sqlx::query("DELETE FROM sessions WHERE id = $1").bind(user.session_id).execute(&state.db).await?;
    Ok((jar.remove(removal_cookie(&state.cfg)), StatusCode::NO_CONTENT))
}

#[derive(Serialize, sqlx::FromRow)]
struct MyVenture {
    id: Uuid,
    slug: String,
    name: String,
    status: VentureStatus,
    role: MemberRole,
}

async fn me(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    let ventures = sqlx::query_as::<_, MyVenture>(
        "SELECT v.id, v.slug, v.name, v.status, m.role
           FROM venture_members m JOIN ventures v ON v.id = m.venture_id
          WHERE m.user_id = $1
          ORDER BY v.name",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "is_admin": user.is_admin,
        "ventures": ventures,
    })))
}

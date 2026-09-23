//! Microsoft Entra ID (OpenID Connect) client: authorization-code flow with PKCE
//! as a confidential client, and ID-token validation against the tenant's JWKS.

use std::time::{Duration, Instant};

use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::Deserialize;
use tokio::sync::{OnceCell, RwLock};
use url::Url;
use uuid::Uuid;

use crate::config::{Config, EntraConfig};
use crate::error::{AppError, AppResult};

const JWKS_MIN_REFRESH: Duration = Duration::from_secs(60);

#[derive(Debug, Deserialize)]
struct Metadata {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    jwks_uri: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    id_token: String,
}

/// Claims we use from an Entra v2.0 ID token.
#[derive(Debug, Deserialize)]
pub struct EntraClaims {
    /// Object ID: stable, tenant-wide identifier for the user.
    pub oid: Uuid,
    pub tid: Uuid,
    pub nonce: Option<String>,
    pub name: Option<String>,
    pub preferred_username: Option<String>,
    pub email: Option<String>,
    #[serde(default)]
    pub roles: Vec<String>,
}

impl EntraClaims {
    pub fn email(&self) -> String {
        self.email.clone().or_else(|| self.preferred_username.clone()).unwrap_or_default()
    }

    pub fn display_name(&self) -> String {
        self.name.clone().unwrap_or_else(|| self.email())
    }
}

pub struct AuthorizeRequest<'a> {
    pub state: &'a str,
    pub nonce: &'a str,
    pub code_challenge: &'a str,
    /// `true`: `prompt=none`, succeed silently from an existing Microsoft session or fail fast.
    /// `false`: `prompt=select_account`, always show Microsoft's account picker so the user
    /// chooses which account to use (existing sessions are listed and still skip the password).
    pub silent: bool,
}

pub struct Oidc {
    entra: EntraConfig,
    redirect_uri: String,
    http: reqwest::Client,
    metadata: OnceCell<Metadata>,
    jwks: RwLock<Option<(JwkSet, Instant)>>,
}

impl Oidc {
    pub fn new(cfg: &Config, http: reqwest::Client) -> Self {
        Self {
            entra: cfg.entra.clone(),
            redirect_uri: cfg.url("/api/auth/callback"),
            http,
            metadata: OnceCell::new(),
            jwks: RwLock::new(None),
        }
    }

    async fn metadata(&self) -> AppResult<&Metadata> {
        self.metadata
            .get_or_try_init(|| async {
                let url = format!(
                    "https://login.microsoftonline.com/{}/v2.0/.well-known/openid-configuration",
                    self.entra.tenant_id
                );
                let meta: Metadata = self.http.get(url).send().await?.error_for_status()?.json().await?;
                tracing::info!(issuer = %meta.issuer, "loaded Entra ID metadata");
                Ok::<_, AppError>(meta)
            })
            .await
    }

    pub async fn authorize_url(&self, req: AuthorizeRequest<'_>) -> AppResult<String> {
        let meta = self.metadata().await?;
        let mut url = Url::parse(&meta.authorization_endpoint).map_err(AppError::internal)?;
        {
            let mut q = url.query_pairs_mut();
            q.append_pair("client_id", &self.entra.client_id)
                .append_pair("response_type", "code")
                .append_pair("response_mode", "query")
                .append_pair("redirect_uri", &self.redirect_uri)
                .append_pair("scope", "openid profile email")
                .append_pair("state", req.state)
                .append_pair("nonce", req.nonce)
                .append_pair("code_challenge", req.code_challenge)
                .append_pair("code_challenge_method", "S256");
            if let Some(hint) = &self.entra.domain_hint {
                q.append_pair("domain_hint", hint);
            }
            q.append_pair("prompt", if req.silent { "none" } else { "select_account" });
        }
        Ok(url.into())
    }

    /// Exchanges an authorization code for a validated set of ID-token claims.
    pub async fn complete_login(&self, code: &str, pkce_verifier: &str, nonce: &str) -> AppResult<EntraClaims> {
        let meta = self.metadata().await?;
        let res = self
            .http
            .post(&meta.token_endpoint)
            .form(&[
                ("client_id", self.entra.client_id.as_str()),
                ("client_secret", self.entra.client_secret.as_str()),
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", self.redirect_uri.as_str()),
                ("code_verifier", pkce_verifier),
                ("scope", "openid profile email"),
            ])
            .send()
            .await?;
        if !res.status().is_success() {
            let body = res.text().await.unwrap_or_default();
            tracing::warn!("Entra token endpoint rejected code exchange: {body}");
            return Err(AppError::bad_request("sign-in could not be completed, please try again"));
        }
        let token: TokenResponse = res.json().await?;
        self.verify_id_token(&token.id_token, nonce).await
    }

    async fn verify_id_token(&self, id_token: &str, nonce: &str) -> AppResult<EntraClaims> {
        let meta = self.metadata().await?;
        let header = decode_header(id_token).map_err(|e| invalid_token(format!("bad header: {e}")))?;
        if header.alg != Algorithm::RS256 {
            return Err(invalid_token(format!("unexpected alg {:?}", header.alg)));
        }
        let kid = header.kid.ok_or_else(|| invalid_token("missing kid".into()))?;
        let key = self.decoding_key(&meta.jwks_uri, &kid).await?;

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[&self.entra.client_id]);
        validation.set_issuer(&[&meta.issuer]);
        let claims = decode::<EntraClaims>(id_token, &key, &validation)
            .map_err(|e| invalid_token(e.to_string()))?
            .claims;

        if claims.nonce.as_deref() != Some(nonce) {
            return Err(invalid_token("nonce mismatch".into()));
        }
        if !claims.tid.to_string().eq_ignore_ascii_case(&self.entra.tenant_id) {
            return Err(AppError::forbidden());
        }
        Ok(claims)
    }

    /// Looks up the signing key, refreshing the JWKS when an unknown `kid` appears (key rollover).
    async fn decoding_key(&self, jwks_uri: &str, kid: &str) -> AppResult<DecodingKey> {
        {
            let cache = self.jwks.read().await;
            if let Some((set, fetched)) = cache.as_ref() {
                if let Some(jwk) = set.find(kid) {
                    return DecodingKey::from_jwk(jwk).map_err(AppError::internal);
                }
                if fetched.elapsed() < JWKS_MIN_REFRESH {
                    return Err(invalid_token(format!("unknown kid {kid}")));
                }
            }
        }
        let mut cache = self.jwks.write().await;
        let set: JwkSet = self.http.get(jwks_uri).send().await?.error_for_status()?.json().await?;
        let key = set.find(kid).map(DecodingKey::from_jwk);
        *cache = Some((set, Instant::now()));
        match key {
            Some(k) => k.map_err(AppError::internal),
            None => Err(invalid_token(format!("unknown kid {kid}"))),
        }
    }
}

fn invalid_token(detail: String) -> AppError {
    tracing::warn!("rejected ID token: {detail}");
    AppError::new(axum::http::StatusCode::UNAUTHORIZED, "invalid_token", "sign-in token was not accepted")
}

use std::env;

use url::Url;

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: String,
    pub database_url: String,
    /// Public origin the browser sees, e.g. `https://market.eduvos.com` or `http://localhost:8080`.
    pub public_base_url: Url,
    pub entra: EntraConfig,
    /// Redirect URIs the native app may ask to be sent back to after login,
    /// e.g. `eduvosmarket://auth`.
    pub app_redirect_uris: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct EntraConfig {
    /// Directory (tenant) ID GUID.
    pub tenant_id: String,
    pub client_id: String,
    pub client_secret: String,
    /// Optional `domain_hint`, e.g. `eduvos.com`, to skip Microsoft's account-type picker.
    pub domain_hint: Option<String>,
    pub admin_role: String,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let public_base_url = parse_url("PUBLIC_BASE_URL", &var_or("PUBLIC_BASE_URL", "http://localhost:8080"))?;
        Ok(Self {
            bind: var_or("BIND", "0.0.0.0:8090"),
            database_url: var("DATABASE_URL")?,
            public_base_url,
            entra: EntraConfig {
                tenant_id: var("ENTRA_TENANT_ID")?,
                client_id: var("ENTRA_CLIENT_ID")?,
                client_secret: var("ENTRA_CLIENT_SECRET")?,
                domain_hint: opt("ENTRA_DOMAIN_HINT"),
                admin_role: var_or("ENTRA_ADMIN_ROLE", "Marketplace.Admin"),
            },
            app_redirect_uris: var_or("APP_REDIRECT_URIS", "eduvosmarket://auth")
                .split(',')
                .map(|s| s.trim().to_owned())
                .filter(|s| !s.is_empty())
                .collect(),
        })
    }

    /// `scheme://host[:port]` without a trailing slash, as sent in the `Origin` header.
    pub fn public_origin(&self) -> String {
        self.public_base_url.origin().ascii_serialization()
    }

    pub fn secure_cookies(&self) -> bool {
        self.public_base_url.scheme() == "https"
    }

    /// Absolute URL for a path on the public origin, e.g. `url("/api/auth/callback")`.
    pub fn url(&self, path: &str) -> String {
        format!("{}{}", self.public_origin(), path)
    }
}

fn var(name: &str) -> Result<String, String> {
    opt(name).ok_or_else(|| format!("missing environment variable {name}"))
}

fn opt(name: &str) -> Option<String> {
    env::var(name).ok().filter(|v| !v.trim().is_empty())
}

fn var_or(name: &str, default: &str) -> String {
    opt(name).unwrap_or_else(|| default.to_owned())
}

fn parse_url(name: &str, value: &str) -> Result<Url, String> {
    Url::parse(value).map_err(|e| format!("{name} is not a valid URL: {e}"))
}

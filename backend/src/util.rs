use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::Rng;
use sha2::{Digest, Sha256};

/// 256-bit random token, base64url encoded (43 chars).
pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn sha256(input: &str) -> Vec<u8> {
    Sha256::digest(input.as_bytes()).to_vec()
}

/// RFC 7636 S256 code challenge for a PKCE verifier.
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Only allow same-site relative paths as post-login destinations (no open redirects).
pub fn safe_return_to(value: Option<&str>) -> String {
    match value {
        Some(v) if v.starts_with('/') && !v.starts_with("//") && !v.contains('\\') && !v.contains(['\r', '\n']) => {
            v.to_owned()
        }
        _ => "/".to_owned(),
    }
}

/// Appends `key=value` to a URL or path that may already have a query string.
pub fn with_query(base: &str, key: &str, value: &str) -> String {
    let sep = if base.contains('?') { '&' } else { '?' };
    let value: String = url::form_urlencoded::byte_serialize(value.as_bytes()).collect();
    format!("{base}{sep}{key}={value}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn return_to_rejects_open_redirects() {
        assert_eq!(safe_return_to(Some("/account?tab=1")), "/account?tab=1");
        assert_eq!(safe_return_to(Some("//evil.com")), "/");
        assert_eq!(safe_return_to(Some("/\\evil.com")), "/");
        assert_eq!(safe_return_to(Some("https://evil.com")), "/");
        assert_eq!(safe_return_to(Some("/a\r\nSet-Cookie: x")), "/");
        assert_eq!(safe_return_to(None), "/");
    }

    #[test]
    fn pkce_challenge_is_base64url_sha256() {
        // Cross-checked with Python: base64.urlsafe_b64encode(hashlib.sha256(v).digest()).rstrip(b"=")
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU2p1r-wW1gFWFOEjXk"),
            "ds6m7b3BphPhC5KVSTwj-8sjyMhumHpOHDawE-oZNgQ"
        );
    }

    #[test]
    fn with_query_appends() {
        assert_eq!(with_query("/a", "k", "v w"), "/a?k=v+w");
        assert_eq!(with_query("/a?x=1", "k", "v"), "/a?x=1&k=v");
    }
}

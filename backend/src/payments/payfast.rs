//! PayFast (https://developers.payfast.co.za) redirect checkout and ITN (instant transaction notification).
//!
//! 1. `POST /orders/{id}/pay` creates a `payments` row and returns a one-time checkout URL.
//! 2. `GET /payments/payfast/checkout/{token}` renders an auto-submitting form to PayFast.
//! 3. PayFast posts the result to `POST /payments/payfast/notify` (server to server). The order
//!    only becomes `paid` here, after the signature, a validation call back to PayFast and the
//!    amount have all been checked.
//! 4. The buyer's browser lands on `GET /payments/payfast/return/{payment_id}`, which sends them
//!    back to the web app or the native app.

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::Router;
use md5::{Digest, Md5};
use serde::Deserialize;
use uuid::Uuid;

use crate::AppState;
use crate::config::PayfastConfig;
use crate::error::{AppError, AppResult};
use crate::models::{OrderStatus, PaymentStatus, SessionKind};
use crate::util::{audit, sha256};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/payments/payfast/checkout/{token}", get(checkout))
        .route("/payments/payfast/return/{payment_id}", get(return_to_app))
        .route("/payments/payfast/notify", post(notify))
}

// ------------------------------------------------------------------ signature

/// PHP `urlencode()`, which PayFast's signature is defined against:
/// alphanumerics and `-_.` unchanged, space as `+`, everything else `%XX` uppercase.
fn php_urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// `key=value&key=value` in the given order, values PHP-urlencoded.
fn param_string<'a>(pairs: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    pairs
        .into_iter()
        .map(|(k, v)| format!("{k}={}", php_urlencode(v.trim())))
        .collect::<Vec<_>>()
        .join("&")
}

fn md5_signature(params: &str, passphrase: Option<&str>) -> String {
    let input = match passphrase {
        Some(p) => format!("{params}&passphrase={}", php_urlencode(p.trim())),
        None => params.to_owned(),
    };
    hex::encode(Md5::digest(input.as_bytes()))
}

/// Signature for the checkout form: non-empty fields, in the documented field order.
fn checkout_signature(fields: &[(&str, String)], passphrase: Option<&str>) -> String {
    let params = param_string(fields.iter().filter(|(_, v)| !v.is_empty()).map(|(k, v)| (*k, v.as_str())));
    md5_signature(&params, passphrase)
}

// ------------------------------------------------------------------ checkout

#[derive(sqlx::FromRow)]
struct CheckoutRow {
    payment_id: Uuid,
    amount_cents: i64,
    order_id: Uuid,
    venture_name: String,
    buyer_name: String,
    buyer_email: String,
}

fn format_amount(cents: i64) -> String {
    format!("{}.{:02}", cents / 100, cents % 100)
}

fn parse_amount(value: &str) -> Option<i64> {
    let (whole, frac) = value.trim().split_once('.').unwrap_or((value.trim(), "0"));
    let frac = format!("{frac:0<2}");
    if frac.len() != 2 {
        return None;
    }
    Some(whole.parse::<i64>().ok()? * 100 + frac.parse::<i64>().ok()?)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn message_page(status: StatusCode, message: &str) -> Response {
    let body = format!(
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>\
         <title>Payment</title><p style='font-family:system-ui;padding:2rem'>{}</p>",
        html_escape(message)
    );
    (status, Html(body)).into_response()
}

async fn checkout(State(state): State<AppState>, Path(token): Path<String>) -> AppResult<Response> {
    let row = sqlx::query_as::<_, CheckoutRow>(
        "SELECT p.id AS payment_id, p.amount_cents, o.id AS order_id, v.name AS venture_name,
                u.display_name AS buyer_name, u.email AS buyer_email
           FROM payments p
           JOIN orders o ON o.id = p.order_id
           JOIN ventures v ON v.id = o.venture_id
           JOIN users u ON u.id = o.buyer_id
          WHERE p.checkout_token = $1 AND p.status = 'pending' AND o.status = 'pending_payment'",
    )
    .bind(sha256(&token))
    .fetch_optional(&state.db)
    .await?;
    let Some(row) = row else {
        return Ok(message_page(StatusCode::NOT_FOUND, "This checkout link has expired. Please start the payment again from your order."));
    };

    let pf = &state.cfg.payfast;
    let return_base = state.cfg.url(&format!("/api/payments/payfast/return/{}", row.payment_id));
    let notify_url = format!(
        "{}/api/payments/payfast/notify",
        pf.notify_base_url.clone().unwrap_or_else(|| state.cfg.public_origin())
    );
    // Order matters: it must follow PayFast's documented attribute order for the signature.
    let mut fields: Vec<(&str, String)> = vec![
        ("merchant_id", pf.merchant_id.clone()),
        ("merchant_key", pf.merchant_key.clone()),
        ("return_url", format!("{return_base}?outcome=return")),
        ("cancel_url", format!("{return_base}?outcome=cancel")),
        ("notify_url", notify_url),
        ("name_first", truncate(&row.buyer_name, 100)),
        ("email_address", truncate(&row.buyer_email, 100)),
        ("m_payment_id", row.payment_id.to_string()),
        ("amount", format_amount(row.amount_cents)),
        ("item_name", truncate(&format!("EduvosMarket order from {}", row.venture_name), 100)),
        ("item_description", format!("Order {}", row.order_id)),
    ];
    let signature = checkout_signature(&fields, pf.passphrase.as_deref());
    fields.push(("signature", signature));

    let inputs: String = fields
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("<input type=hidden name=\"{k}\" value=\"{}\">", html_escape(v)))
        .collect();
    let html = format!(
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>\
         <title>Redirecting to PayFast…</title>\
         <body onload=\"document.forms[0].submit()\" style='font-family:system-ui;padding:2rem'>\
         <form action=\"https://{host}/eng/process\" method=post>{inputs}\
         <p>Redirecting you to PayFast to pay R {amount}…</p>\
         <button type=submit>Continue to PayFast</button></form>",
        host = pf.host(),
        amount = format_amount(row.amount_cents),
    );
    Ok(([(header::CACHE_CONTROL, "no-store")], Html(html)).into_response())
}

// ------------------------------------------------------------------ return

#[derive(Deserialize)]
struct ReturnQuery {
    outcome: Option<String>,
}

async fn return_to_app(
    State(state): State<AppState>,
    Path(payment_id): Path<Uuid>,
    Query(q): Query<ReturnQuery>,
) -> AppResult<Redirect> {
    let (order_id, client): (Uuid, SessionKind) =
        sqlx::query_as("SELECT order_id, client FROM payments WHERE id = $1")
            .bind(payment_id)
            .fetch_one(&state.db)
            .await?;
    let outcome = if q.outcome.as_deref() == Some("cancel") { "cancel" } else { "return" };
    let path = format!("orders/{order_id}?payment={outcome}");
    let target = match (client, state.cfg.app_redirect_uris.first()) {
        (SessionKind::App, Some(app)) => {
            let scheme = app.split("://").next().unwrap_or("eduvosmarket");
            format!("{scheme}://{path}")
        }
        _ => format!("/{path}"),
    };
    Ok(Redirect::to(&target))
}

// ------------------------------------------------------------------ ITN

/// Verifies the ITN signature. Fields are signed in the order received, up to `signature`.
fn verify_itn_signature(pairs: &[(String, String)], passphrase: Option<&str>) -> Option<String> {
    let received = pairs.iter().find(|(k, _)| k == "signature").map(|(_, v)| v.as_str())?;
    let params = param_string(
        pairs.iter().take_while(|(k, _)| k != "signature").map(|(k, v)| (k.as_str(), v.as_str())),
    );
    let expected = md5_signature(&params, passphrase);
    // Compare hashes of both to avoid leaking timing information.
    (sha256(&expected) == sha256(&received.to_ascii_lowercase())).then_some(params)
}

async fn validate_with_payfast(http: &reqwest::Client, pf: &PayfastConfig, params: String) -> AppResult<bool> {
    let body = http
        .post(format!("https://{}/eng/query/validate", pf.host()))
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(params)
        .send()
        .await?
        .text()
        .await?;
    Ok(body.trim() == "VALID")
}

#[derive(sqlx::FromRow)]
struct PaymentForUpdate {
    order_id: Uuid,
    amount_cents: i64,
    payment_status: PaymentStatus,
    order_status: OrderStatus,
}

async fn notify(State(state): State<AppState>, body: Bytes) -> AppResult<StatusCode> {
    let pf = &state.cfg.payfast;
    let pairs: Vec<(String, String)> =
        url::form_urlencoded::parse(&body).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    let get = |key: &str| pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str()).unwrap_or("");

    let Some(params) = verify_itn_signature(&pairs, pf.passphrase.as_deref()) else {
        tracing::warn!("PayFast ITN rejected: bad signature");
        return Err(AppError::bad_request("invalid signature"));
    };
    if get("merchant_id") != pf.merchant_id {
        tracing::warn!("PayFast ITN rejected: merchant_id mismatch");
        return Err(AppError::bad_request("merchant mismatch"));
    }
    if !validate_with_payfast(&state.http, pf, params).await? {
        tracing::warn!("PayFast ITN rejected: validation call did not return VALID");
        return Err(AppError::bad_request("not validated"));
    }

    let payment_id = Uuid::parse_str(get("m_payment_id")).map_err(|_| AppError::bad_request("bad m_payment_id"))?;
    let raw: serde_json::Map<String, serde_json::Value> =
        pairs.iter().map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone()))).collect();

    let mut tx = state.db.begin().await?;
    let payment = sqlx::query_as::<_, PaymentForUpdate>(
        "SELECT p.order_id, p.amount_cents, p.status AS payment_status, o.status AS order_status
           FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE p.id = $1
            FOR UPDATE OF p, o",
    )
    .bind(payment_id)
    .fetch_one(&mut *tx)
    .await?;

    if payment.payment_status == PaymentStatus::Complete {
        return Ok(StatusCode::OK); // Replayed ITN: already processed.
    }

    let new_status = match get("payment_status") {
        "COMPLETE" => PaymentStatus::Complete,
        "CANCELLED" => PaymentStatus::Cancelled,
        "FAILED" => PaymentStatus::Failed,
        _ => return Ok(StatusCode::OK), // e.g. PENDING: wait for the final notification.
    };
    if new_status == PaymentStatus::Complete && parse_amount(get("amount_gross")) != Some(payment.amount_cents) {
        tracing::error!(%payment_id, amount_gross = get("amount_gross"), "PayFast amount mismatch");
        return Err(AppError::bad_request("amount mismatch"));
    }

    sqlx::query(
        "UPDATE payments SET status = $2, pf_payment_id = NULLIF($3, ''), raw_itn = $4, updated_at = now() WHERE id = $1",
    )
    .bind(payment_id)
    .bind(new_status)
    .bind(get("pf_payment_id"))
    .bind(serde_json::Value::Object(raw))
    .execute(&mut *tx)
    .await?;

    if new_status == PaymentStatus::Complete {
        if payment.order_status == OrderStatus::PendingPayment {
            sqlx::query("UPDATE orders SET status = 'paid', updated_at = now() WHERE id = $1")
                .bind(payment.order_id)
                .execute(&mut *tx)
                .await?;
            audit(&mut tx, None, "order.paid", "order", payment.order_id, None).await?;
        } else {
            // e.g. the order expired while the buyer was on PayFast: needs a manual refund.
            audit(&mut tx, None, "payment.refund_required", "order", payment.order_id, Some("paid after order was closed")).await?;
        }
    }
    tx.commit().await?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlencode_matches_php() {
        assert_eq!(php_urlencode("Test Item & more ~*"), "Test+Item+%26+more+%7E%2A");
        assert_eq!(php_urlencode("https://a.b/c?d=e"), "https%3A%2F%2Fa.b%2Fc%3Fd%3De");
        assert_eq!(php_urlencode("é"), "%C3%A9");
    }

    #[test]
    fn checkout_signature_skips_empty_fields_and_appends_passphrase() {
        let fields = vec![
            ("merchant_id", "10000100".to_owned()),
            ("merchant_key", "46f0cd694581a".to_owned()),
            ("name_first", String::new()),
            ("amount", "100.00".to_owned()),
            ("item_name", "Test Item".to_owned()),
        ];
        let expected_input = "merchant_id=10000100&merchant_key=46f0cd694581a&amount=100.00&item_name=Test+Item&passphrase=jt7NOE43FZPn";
        assert_eq!(
            checkout_signature(&fields, Some("jt7NOE43FZPn")),
            hex::encode(Md5::digest(expected_input.as_bytes()))
        );
    }

    #[test]
    fn itn_signature_round_trip() {
        let mut pairs: Vec<(String, String)> = [
            ("m_payment_id", "abc"),
            ("pf_payment_id", "1089250"),
            ("payment_status", "COMPLETE"),
            ("item_name", "Order from Bob's Bakes"),
            ("amount_gross", "200.00"),
            ("name_last", ""),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let params = param_string(pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        pairs.push(("signature".into(), md5_signature(&params, Some("secret"))));

        assert!(verify_itn_signature(&pairs, Some("secret")).is_some());
        assert!(verify_itn_signature(&pairs, Some("wrong")).is_none());
        pairs[4].1 = "1.00".into();
        assert!(verify_itn_signature(&pairs, Some("secret")).is_none());
    }

    #[test]
    fn amounts() {
        assert_eq!(format_amount(12345), "123.45");
        assert_eq!(format_amount(5), "0.05");
        assert_eq!(parse_amount("123.45"), Some(12345));
        assert_eq!(parse_amount("200.5"), Some(20050));
        assert_eq!(parse_amount("200"), Some(20000));
        assert_eq!(parse_amount("1.234"), None);
    }
}

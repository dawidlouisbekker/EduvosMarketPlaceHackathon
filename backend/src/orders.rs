//! Orders: one order per venture, stock reserved at creation, paid through PayFast.
//!
//! pending_payment ──ITN COMPLETE──► paid ──seller accept──► accepted ──seller fulfil──► fulfilled
//!        │                           │                        │
//!        └──── buyer/seller cancel, or unpaid for 60 min ─────┴──► cancelled (stock released)

use std::collections::BTreeMap;
use std::time::Duration as StdDuration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::AppState;
use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::models::{ListingStatus, OrderStatus, SessionKind, VentureStatus};
use crate::util::{audit, random_token, sha256};
use crate::ventures::{self, can_manage, member_role};

const MAX_LINES: usize = 20;
const MAX_QUANTITY: i32 = 20;
const UNPAID_TIMEOUT_MINUTES: i32 = 60;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/orders", get(my_orders).post(create))
        .route("/orders/{id}", get(show))
        .route("/orders/{id}/pay", post(pay))
        .route("/orders/{id}/accept", post(accept))
        .route("/orders/{id}/fulfil", post(fulfil))
        .route("/orders/{id}/cancel", post(cancel))
        .route("/ventures/{venture}/orders", get(venture_orders))
}

// ------------------------------------------------------------------ representation

#[derive(sqlx::FromRow)]
struct OrderRow {
    id: Uuid,
    status: OrderStatus,
    total_cents: i64,
    note: Option<String>,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    venture_id: Uuid,
    venture_slug: String,
    venture_name: String,
    buyer_id: Uuid,
    buyer_name: String,
    buyer_email: String,
}

const ORDER_SELECT: &str = "SELECT o.id, o.status, o.total_cents, o.note, o.created_at, o.updated_at,
        v.id AS venture_id, v.slug AS venture_slug, v.name AS venture_name,
        u.id AS buyer_id, u.display_name AS buyer_name, u.email AS buyer_email
   FROM orders o
   JOIN ventures v ON v.id = o.venture_id
   JOIN users u ON u.id = o.buyer_id";

#[derive(Serialize, sqlx::FromRow)]
struct OrderItem {
    #[serde(skip)]
    order_id: Uuid,
    listing_id: Uuid,
    title: String,
    unit_price_cents: i64,
    quantity: i32,
}

async fn hydrate(db: &PgPool, rows: Vec<OrderRow>) -> AppResult<Vec<Value>> {
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let items = sqlx::query_as::<_, OrderItem>(
        "SELECT order_id, listing_id, title_snapshot AS title, unit_price_cents, quantity
           FROM order_items WHERE order_id = ANY($1) ORDER BY title_snapshot",
    )
    .bind(&ids)
    .fetch_all(db)
    .await?;
    let mut by_order: BTreeMap<Uuid, Vec<OrderItem>> = BTreeMap::new();
    for item in items {
        by_order.entry(item.order_id).or_default().push(item);
    }
    let fmt = time::format_description::well_known::Rfc3339;
    Ok(rows
        .into_iter()
        .map(|o| {
            json!({
                "id": o.id,
                "status": o.status,
                "total_cents": o.total_cents,
                "currency": "ZAR",
                "note": o.note,
                "venture": { "id": o.venture_id, "slug": o.venture_slug, "name": o.venture_name },
                "buyer": { "id": o.buyer_id, "display_name": o.buyer_name, "email": o.buyer_email },
                "items": by_order.remove(&o.id).unwrap_or_default(),
                "created_at": o.created_at.format(&fmt).ok(),
                "updated_at": o.updated_at.format(&fmt).ok(),
            })
        })
        .collect())
}

async fn find(db: &PgPool, id: Uuid) -> AppResult<OrderRow> {
    Ok(sqlx::query_as::<_, OrderRow>(sqlx::AssertSqlSafe(format!("{ORDER_SELECT} WHERE o.id = $1")))
        .bind(id)
        .fetch_one(db)
        .await?)
}

async fn one(db: &PgPool, id: Uuid) -> AppResult<Json<Value>> {
    let row = find(db, id).await?;
    Ok(Json(hydrate(db, vec![row]).await?.pop().unwrap_or_default()))
}

// ------------------------------------------------------------------ buyer

#[derive(Deserialize)]
struct NewOrder {
    items: Vec<NewItem>,
    note: Option<String>,
}

#[derive(Deserialize)]
struct NewItem {
    listing_id: Uuid,
    quantity: i32,
}

#[derive(sqlx::FromRow)]
struct LockedListing {
    id: Uuid,
    venture_id: Uuid,
    title: String,
    price_cents: i64,
    stock: Option<i32>,
    status: ListingStatus,
    venture_status: VentureStatus,
}

/// Checks out a cart. Items are split into one order per venture; stock is reserved immediately.
async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<NewOrder>,
) -> AppResult<(StatusCode, Json<Vec<Value>>)> {
    let mut quantities: BTreeMap<Uuid, i32> = BTreeMap::new();
    for item in &body.items {
        *quantities.entry(item.listing_id).or_default() += item.quantity;
    }
    if quantities.is_empty() || quantities.len() > MAX_LINES {
        return Err(AppError::bad_request(format!("an order must have between 1 and {MAX_LINES} items")));
    }
    if quantities.values().any(|&q| !(1..=MAX_QUANTITY).contains(&q)) {
        return Err(AppError::bad_request(format!("quantities must be between 1 and {MAX_QUANTITY}")));
    }
    let note = body.note.map(|n| n.trim().chars().take(500).collect::<String>()).filter(|n| !n.is_empty());
    let ids: Vec<Uuid> = quantities.keys().copied().collect();

    let mut tx = state.db.begin().await?;
    let listings = sqlx::query_as::<_, LockedListing>(
        "SELECT l.id, l.venture_id, l.title, l.price_cents, l.stock, l.status, v.status AS venture_status
           FROM listings l JOIN ventures v ON v.id = l.venture_id
          WHERE l.id = ANY($1)
          ORDER BY l.id
            FOR UPDATE OF l",
    )
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    if listings.len() != ids.len()
        || listings.iter().any(|l| l.status != ListingStatus::Published || l.venture_status != VentureStatus::Approved)
    {
        return Err(AppError::conflict("unavailable", "one or more items are no longer available"));
    }

    let venture_ids: Vec<Uuid> = listings.iter().map(|l| l.venture_id).collect();
    let own: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM venture_members WHERE user_id = $1 AND venture_id = ANY($2))",
    )
    .bind(user.id)
    .bind(&venture_ids)
    .fetch_one(&mut *tx)
    .await?;
    if own {
        return Err(AppError::conflict("own_listing", "you cannot order from your own venture"));
    }

    let mut by_venture: BTreeMap<Uuid, Vec<(&LockedListing, i32)>> = BTreeMap::new();
    for listing in &listings {
        let qty = quantities[&listing.id];
        if let Some(stock) = listing.stock {
            if stock < qty {
                return Err(AppError::conflict("out_of_stock", format!("only {stock} of \"{}\" left", listing.title)));
            }
            sqlx::query("UPDATE listings SET stock = stock - $2 WHERE id = $1")
                .bind(listing.id)
                .bind(qty)
                .execute(&mut *tx)
                .await?;
        }
        by_venture.entry(listing.venture_id).or_default().push((listing, qty));
    }

    let mut order_ids = Vec::new();
    for (venture_id, lines) in by_venture {
        let order_id = Uuid::now_v7();
        let total: i64 = lines.iter().map(|(l, q)| l.price_cents * i64::from(*q)).sum();
        sqlx::query("INSERT INTO orders (id, buyer_id, venture_id, total_cents, note) VALUES ($1, $2, $3, $4, $5)")
            .bind(order_id)
            .bind(user.id)
            .bind(venture_id)
            .bind(total)
            .bind(&note)
            .execute(&mut *tx)
            .await?;
        for (listing, qty) in lines {
            sqlx::query(
                "INSERT INTO order_items (order_id, listing_id, title_snapshot, unit_price_cents, quantity)
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(order_id)
            .bind(listing.id)
            .bind(&listing.title)
            .bind(listing.price_cents)
            .bind(qty)
            .execute(&mut *tx)
            .await?;
        }
        order_ids.push(order_id);
    }
    tx.commit().await?;

    let rows = sqlx::query_as::<_, OrderRow>(sqlx::AssertSqlSafe(format!("{ORDER_SELECT} WHERE o.id = ANY($1) ORDER BY o.id")))
        .bind(&order_ids)
        .fetch_all(&state.db)
        .await?;
    Ok((StatusCode::CREATED, Json(hydrate(&state.db, rows).await?)))
}

async fn my_orders(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<Value>>> {
    let rows = sqlx::query_as::<_, OrderRow>(sqlx::AssertSqlSafe(format!("{ORDER_SELECT} WHERE o.buyer_id = $1 ORDER BY o.id DESC LIMIT 100")))
        .bind(user.id)
        .fetch_all(&state.db)
        .await?;
    Ok(Json(hydrate(&state.db, rows).await?))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    let order = find(&state.db, id).await?;
    if order.buyer_id != user.id && !can_manage(&state.db, order.venture_id, Some(&user)).await? {
        return Err(AppError::not_found());
    }
    one(&state.db, id).await
}

#[derive(Deserialize, Default)]
struct PayBody {
    client: Option<SessionKind>,
}

/// Starts a PayFast checkout. Returns a one-time URL the client opens in a browser
/// (web: navigate to it; native: `WebBrowser.openAuthSessionAsync`).
async fn pay(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    body: Option<Json<PayBody>>,
) -> AppResult<Json<Value>> {
    let order = find(&state.db, id).await?;
    if order.buyer_id != user.id {
        return Err(AppError::not_found());
    }
    if order.status != OrderStatus::PendingPayment {
        return Err(AppError::conflict("invalid_status", "this order is not awaiting payment"));
    }
    let client = body.and_then(|b| b.0.client).unwrap_or(SessionKind::Web);
    let token = random_token();
    let payment_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO payments (id, order_id, checkout_token, client, amount_cents) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(payment_id)
    .bind(id)
    .bind(sha256(&token))
    .bind(client)
    .bind(order.total_cents)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({
        "payment_id": payment_id,
        "checkout_url": state.cfg.url(&format!("/api/payments/payfast/checkout/{token}")),
    })))
}

// ------------------------------------------------------------------ status transitions

#[derive(Clone, Copy)]
enum Action {
    Accept,
    Fulfil,
    Cancel,
}

async fn transition(state: &AppState, user: &AuthUser, id: Uuid, action: Action) -> AppResult<Json<Value>> {
    let mut tx = state.db.begin().await?;
    let (buyer_id, venture_id, status): (Uuid, Uuid, OrderStatus) =
        sqlx::query_as("SELECT buyer_id, venture_id, status FROM orders WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    let is_buyer = buyer_id == user.id;
    let is_seller = member_role(&state.db, venture_id, user.id).await?.is_some();
    if !is_buyer && !is_seller {
        return Err(AppError::not_found());
    }

    use OrderStatus::*;
    let next = match (action, status) {
        (Action::Accept, Paid) if is_seller => Accepted,
        (Action::Fulfil, Accepted) if is_seller => Fulfilled,
        (Action::Cancel, PendingPayment) => Cancelled,
        (Action::Cancel, Paid | Accepted) if is_seller => Cancelled,
        (_, current) => {
            return Err(AppError::conflict(
                "invalid_transition",
                format!("this order cannot be changed from {current:?} by you"),
            ));
        }
    };

    sqlx::query("UPDATE orders SET status = $2, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(next)
        .execute(&mut *tx)
        .await?;
    let audit_action = match (action, status) {
        (Action::Accept, _) => "order.accept",
        (Action::Fulfil, _) => "order.fulfil",
        (Action::Cancel, Paid | Accepted) => "order.cancel_refund_required",
        (Action::Cancel, _) => "order.cancel",
    };
    if next == Cancelled {
        release_stock(&mut tx, id).await?;
    }
    audit(&mut tx, Some(user.id), audit_action, "order", id, None).await?;
    tx.commit().await?;
    one(&state.db, id).await
}

async fn accept(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    transition(&state, &user, id, Action::Accept).await
}

async fn fulfil(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    transition(&state, &user, id, Action::Fulfil).await
}

async fn cancel(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    transition(&state, &user, id, Action::Cancel).await
}

pub async fn release_stock(conn: &mut PgConnection, order_id: Uuid) -> AppResult<()> {
    sqlx::query(
        "UPDATE listings l SET stock = l.stock + i.quantity
           FROM order_items i
          WHERE i.order_id = $1 AND l.id = i.listing_id AND l.stock IS NOT NULL",
    )
    .bind(order_id)
    .execute(conn)
    .await?;
    Ok(())
}

// ------------------------------------------------------------------ seller

async fn venture_orders(
    State(state): State<AppState>,
    user: AuthUser,
    Path(key): Path<String>,
) -> AppResult<Json<Vec<Value>>> {
    let venture = ventures::find(&state.db, &key).await?;
    if !can_manage(&state.db, venture.id, Some(&user)).await? {
        return Err(AppError::forbidden());
    }
    let rows = sqlx::query_as::<_, OrderRow>(sqlx::AssertSqlSafe(format!(
        "{ORDER_SELECT} WHERE o.venture_id = $1 ORDER BY o.id DESC LIMIT 200"
    )))
    .bind(venture.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(hydrate(&state.db, rows).await?))
}

// ------------------------------------------------------------------ background job

/// Cancels orders that stayed unpaid too long, releasing their reserved stock.
pub async fn expire_unpaid_orders(state: AppState) {
    let mut interval = tokio::time::interval(StdDuration::from_secs(60));
    loop {
        interval.tick().await;
        if let Err(e) = expire_once(&state.db).await {
            tracing::warn!("order expiry failed: {}", e.message);
        }
    }
}

async fn expire_once(db: &PgPool) -> AppResult<()> {
    let mut tx = db.begin().await?;
    let expired: Vec<Uuid> = sqlx::query_scalar(
        "UPDATE orders SET status = 'cancelled', updated_at = now()
          WHERE id IN (SELECT id FROM orders
                        WHERE status = 'pending_payment'
                          AND created_at < now() - make_interval(mins => $1)
                        FOR UPDATE SKIP LOCKED)
      RETURNING id",
    )
    .bind(UNPAID_TIMEOUT_MINUTES)
    .fetch_all(&mut *tx)
    .await?;
    for id in &expired {
        release_stock(&mut tx, *id).await?;
        audit(&mut tx, None, "order.expire", "order", *id, None).await?;
    }
    tx.commit().await?;
    if !expired.is_empty() {
        tracing::info!(count = expired.len(), "expired unpaid orders");
    }
    Ok(())
}

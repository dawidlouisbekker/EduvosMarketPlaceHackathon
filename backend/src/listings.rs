//! Product and service listings: public catalogue, seller management and the review lifecycle.
//!
//! draft ──submit──► pending_review ──admin approve──► published
//!   ▲                    │  ▲                             │
//!   │               admin reject                    content edit
//!   │                    ▼  │                             │
//!   └──────────────── rejected ◄───────────────────────────┘ (edits go back to pending_review)

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, QueryBuilder};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::AppState;
use crate::auth::{AuthUser, MaybeUser};
use crate::error::{AppError, AppResult};
use crate::media::Media;
use crate::models::{ListingKind, ListingStatus, VentureStatus};
use crate::util::{audit, validate_text};
use crate::ventures::{self, can_manage, require_member};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/categories", get(categories))
        .route("/listings", get(search))
        .route("/listings/{id}", get(show).patch(update).delete(archive))
        .route("/listings/{id}/submit", post(submit))
        .route("/ventures/{venture}/listings", get(venture_listings).post(create))
}

// ------------------------------------------------------------------ representation

#[derive(sqlx::FromRow)]
pub struct ListingRow {
    pub id: Uuid,
    pub venture_id: Uuid,
    pub venture_slug: String,
    pub venture_name: String,
    pub venture_status: VentureStatus,
    pub kind: ListingKind,
    pub title: String,
    pub description: String,
    pub category: Option<String>,
    pub price_cents: i64,
    pub stock: Option<i32>,
    pub status: ListingStatus,
    pub rejection_reason: Option<String>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

pub const LISTING_SELECT: &str = "SELECT l.id, l.venture_id, v.slug AS venture_slug, v.name AS venture_name,
        v.status AS venture_status, l.kind, l.title, l.description, c.slug AS category, l.price_cents,
        l.stock, l.status, l.rejection_reason, l.created_at, l.updated_at
   FROM listings l
   JOIN ventures v ON v.id = l.venture_id
   LEFT JOIN categories c ON c.id = l.category_id";

#[derive(Serialize)]
pub struct VentureRef {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
}

#[derive(Serialize, Clone)]
pub struct Image {
    pub id: Uuid,
    pub url: String,
}

#[derive(Serialize)]
pub struct Listing {
    pub id: Uuid,
    pub venture: VentureRef,
    pub kind: ListingKind,
    pub title: String,
    pub description: String,
    pub category: Option<String>,
    pub price_cents: i64,
    pub currency: &'static str,
    pub stock: Option<i32>,
    pub status: ListingStatus,
    pub rejection_reason: Option<String>,
    pub images: Vec<Image>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(sqlx::FromRow)]
struct ImageRow {
    id: Uuid,
    listing_id: Uuid,
    object_key: String,
}

/// Attaches images to listing rows with a single extra query.
pub async fn hydrate(db: &PgPool, media: &Media, rows: Vec<ListingRow>) -> AppResult<Vec<Listing>> {
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let images = sqlx::query_as::<_, ImageRow>(
        "SELECT id, listing_id, object_key FROM listing_images WHERE listing_id = ANY($1) ORDER BY position, id",
    )
    .bind(&ids)
    .fetch_all(db)
    .await?;
    let mut by_listing: HashMap<Uuid, Vec<Image>> = HashMap::new();
    for img in images {
        by_listing
            .entry(img.listing_id)
            .or_default()
            .push(Image { id: img.id, url: media.public_url(&img.object_key) });
    }
    Ok(rows
        .into_iter()
        .map(|r| Listing {
            images: by_listing.remove(&r.id).unwrap_or_default(),
            id: r.id,
            venture: VentureRef { id: r.venture_id, slug: r.venture_slug, name: r.venture_name },
            kind: r.kind,
            title: r.title,
            description: r.description,
            category: r.category,
            price_cents: r.price_cents,
            currency: "ZAR",
            stock: r.stock,
            status: r.status,
            rejection_reason: r.rejection_reason,
            created_at: r.created_at,
            updated_at: r.updated_at,
        })
        .collect())
}

pub async fn find(db: &PgPool, id: Uuid) -> AppResult<ListingRow> {
    Ok(sqlx::query_as::<_, ListingRow>(sqlx::AssertSqlSafe(format!("{LISTING_SELECT} WHERE l.id = $1")))
        .bind(id)
        .fetch_one(db)
        .await?)
}

async fn one(state: &AppState, id: Uuid) -> AppResult<Json<Listing>> {
    let row = find(&state.db, id).await?;
    let listing = hydrate(&state.db, &state.media, vec![row]).await?.pop().ok_or_else(AppError::not_found)?;
    Ok(Json(listing))
}

async fn category_id(db: &PgPool, slug: &str) -> AppResult<i32> {
    sqlx::query_scalar("SELECT id FROM categories WHERE slug = $1")
        .bind(slug)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::bad_request(format!("unknown category '{slug}'")))
}

// ------------------------------------------------------------------ public catalogue

#[derive(Serialize, sqlx::FromRow)]
struct Category {
    slug: String,
    name: String,
}

async fn categories(State(state): State<AppState>) -> AppResult<Json<Vec<Category>>> {
    let rows = sqlx::query_as::<_, Category>("SELECT slug, name FROM categories ORDER BY id")
        .fetch_all(&state.db)
        .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
    category: Option<String>,
    kind: Option<ListingKind>,
    venture: Option<String>,
    /// Id of the last listing on the previous page.
    cursor: Option<Uuid>,
    limit: Option<i64>,
}

#[derive(Serialize)]
struct Page {
    items: Vec<Listing>,
    next_cursor: Option<Uuid>,
}

/// Published listings of approved ventures, newest first.
async fn search(State(state): State<AppState>, Query(q): Query<SearchQuery>) -> AppResult<Json<Page>> {
    let limit = q.limit.unwrap_or(20).clamp(1, 50);
    let mut sql: QueryBuilder<Postgres> = QueryBuilder::new(LISTING_SELECT);
    sql.push(" WHERE l.status = 'published' AND v.status = 'approved'");
    if let Some(text) = q.q.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        sql.push(" AND l.search @@ websearch_to_tsquery('english', ").push_bind(text.to_owned()).push(")");
    }
    if let Some(category) = q.category {
        sql.push(" AND c.slug = ").push_bind(category);
    }
    if let Some(kind) = q.kind {
        sql.push(" AND l.kind = ").push_bind(kind);
    }
    if let Some(venture) = q.venture {
        sql.push(" AND v.slug = ").push_bind(venture);
    }
    if let Some(cursor) = q.cursor {
        sql.push(" AND l.id < ").push_bind(cursor);
    }
    sql.push(" ORDER BY l.id DESC LIMIT ").push_bind(limit);

    let rows = sql.build_query_as::<ListingRow>().fetch_all(&state.db).await?;
    let next_cursor = if rows.len() as i64 == limit { rows.last().map(|r| r.id) } else { None };
    let items = hydrate(&state.db, &state.media, rows).await?;
    Ok(Json(Page { items, next_cursor }))
}

async fn show(
    State(state): State<AppState>,
    MaybeUser(user): MaybeUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Listing>> {
    let row = find(&state.db, id).await?;
    let public = row.status == ListingStatus::Published && row.venture_status == VentureStatus::Approved;
    if !public && !can_manage(&state.db, row.venture_id, user.as_ref()).await? {
        return Err(AppError::not_found());
    }
    one(&state, id).await
}

// ------------------------------------------------------------------ seller management

/// All non-archived listings of a venture, for its members (and admins).
async fn venture_listings(
    State(state): State<AppState>,
    user: AuthUser,
    Path(key): Path<String>,
) -> AppResult<Json<Vec<Listing>>> {
    let venture = ventures::find(&state.db, &key).await?;
    if !can_manage(&state.db, venture.id, Some(&user)).await? {
        return Err(AppError::forbidden());
    }
    let rows = sqlx::query_as::<_, ListingRow>(sqlx::AssertSqlSafe(format!(
        "{LISTING_SELECT} WHERE l.venture_id = $1 AND l.status <> 'archived' ORDER BY l.id DESC"
    )))
    .bind(venture.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(hydrate(&state.db, &state.media, rows).await?))
}

#[derive(Deserialize)]
struct CreateListing {
    kind: ListingKind,
    title: String,
    #[serde(default)]
    description: String,
    category: Option<String>,
    price_cents: i64,
    stock: Option<i32>,
}

fn validate_price_stock(price_cents: Option<i64>, stock: Option<i32>) -> AppResult<()> {
    if price_cents.is_some_and(|p| !(0..=10_000_000).contains(&p)) {
        return Err(AppError::bad_request("price must be between R0 and R100 000"));
    }
    if stock.is_some_and(|s| s < 0) {
        return Err(AppError::bad_request("stock cannot be negative"));
    }
    Ok(())
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Path(key): Path<String>,
    Json(body): Json<CreateListing>,
) -> AppResult<(StatusCode, Json<Listing>)> {
    let venture = ventures::find(&state.db, &key).await?;
    require_member(&state.db, venture.id, &user).await?;
    validate_text("title", &body.title, 3, 120)?;
    validate_text("description", &body.description, 0, 5000)?;
    validate_price_stock(Some(body.price_cents), body.stock)?;
    let category_id = match &body.category {
        Some(slug) => Some(category_id(&state.db, slug).await?),
        None => None,
    };

    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO listings (id, venture_id, kind, title, description, category_id, price_cents, stock)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(id)
    .bind(venture.id)
    .bind(body.kind)
    .bind(body.title.trim())
    .bind(body.description.trim())
    .bind(category_id)
    .bind(body.price_cents)
    .bind(body.stock)
    .execute(&state.db)
    .await?;
    Ok((StatusCode::CREATED, one(&state, id).await?))
}

#[derive(Deserialize)]
struct UpdateListing {
    kind: Option<ListingKind>,
    title: Option<String>,
    description: Option<String>,
    category: Option<String>,
    price_cents: Option<i64>,
    /// Stock-only updates do not trigger a new review. `null` means unlimited.
    #[serde(default, deserialize_with = "crate::util::nullable")]
    stock: Option<Option<i32>>,
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateListing>,
) -> AppResult<Json<Listing>> {
    let listing = find(&state.db, id).await?;
    require_member(&state.db, listing.venture_id, &user).await?;
    if listing.status == ListingStatus::Archived {
        return Err(AppError::conflict("archived", "archived listings cannot be edited"));
    }
    if let Some(title) = &body.title {
        validate_text("title", title, 3, 120)?;
    }
    if let Some(description) = &body.description {
        validate_text("description", description, 0, 5000)?;
    }
    validate_price_stock(body.price_cents, body.stock.flatten())?;
    let category_id = match &body.category {
        Some(slug) => Some(category_id(&state.db, slug).await?),
        None => None,
    };

    let content_changed = body.kind.is_some()
        || body.title.is_some()
        || body.description.is_some()
        || body.category.is_some()
        || body.price_cents.is_some();
    let status = match listing.status {
        ListingStatus::Published | ListingStatus::Rejected if content_changed => ListingStatus::PendingReview,
        s => s,
    };

    sqlx::query(
        "UPDATE listings SET
            kind = COALESCE($2, kind),
            title = COALESCE($3, title),
            description = COALESCE($4, description),
            category_id = COALESCE($5, category_id),
            price_cents = COALESCE($6, price_cents),
            stock = CASE WHEN $7 THEN $8 ELSE stock END,
            status = $9,
            rejection_reason = CASE WHEN $9 = 'pending_review' THEN NULL ELSE rejection_reason END,
            updated_at = now()
         WHERE id = $1",
    )
    .bind(id)
    .bind(body.kind)
    .bind(body.title.as_deref().map(str::trim))
    .bind(body.description.as_deref().map(str::trim))
    .bind(category_id)
    .bind(body.price_cents)
    .bind(body.stock.is_some())
    .bind(body.stock.flatten())
    .bind(status)
    .execute(&state.db)
    .await?;
    one(&state, id).await
}

/// Sends a listing back to review after an image change (called by the media module).
pub async fn mark_changed(db: &PgPool, id: Uuid) -> AppResult<()> {
    sqlx::query(
        "UPDATE listings SET status = 'pending_review', rejection_reason = NULL, updated_at = now()
          WHERE id = $1 AND status IN ('published', 'rejected')",
    )
    .bind(id)
    .execute(db)
    .await?;
    Ok(())
}

async fn submit(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Listing>> {
    let listing = find(&state.db, id).await?;
    require_member(&state.db, listing.venture_id, &user).await?;
    if !matches!(listing.status, ListingStatus::Draft | ListingStatus::Rejected) {
        return Err(AppError::conflict("invalid_status", "only draft or rejected listings can be submitted"));
    }
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "UPDATE listings SET status = 'pending_review', rejection_reason = NULL, updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    audit(&mut tx, Some(user.id), "listing.submit", "listing", id, None).await?;
    tx.commit().await?;
    one(&state, id).await
}

/// Listings are archived rather than deleted so past orders keep their reference.
async fn archive(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let listing = find(&state.db, id).await?;
    require_member(&state.db, listing.venture_id, &user).await?;
    sqlx::query("UPDATE listings SET status = 'archived', updated_at = now() WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

//! Hub staff moderation. Requires the Entra `Marketplace.Admin` app role.

use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::AppState;
use crate::auth::AdminUser;
use crate::error::{AppError, AppResult};
use crate::listings::{self, LISTING_SELECT, Listing, ListingRow};
use crate::models::{ListingStatus, VentureStatus};
use crate::util::audit;
use crate::ventures::{VENTURE_COLUMNS, Venture, VentureRow};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/queue", get(queue))
        .route("/admin/ventures/{id}/approve", post(approve_venture))
        .route("/admin/ventures/{id}/suspend", post(suspend_venture))
        .route("/admin/listings/{id}/approve", post(approve_listing))
        .route("/admin/listings/{id}/reject", post(reject_listing))
        .route("/admin/audit", get(audit_log))
}

#[derive(Serialize)]
struct Queue {
    ventures: Vec<Venture>,
    listings: Vec<Listing>,
}

/// Everything waiting for a decision, oldest first.
async fn queue(State(state): State<AppState>, _admin: AdminUser) -> AppResult<Json<Queue>> {
    let ventures = sqlx::query_as::<_, VentureRow>(sqlx::AssertSqlSafe(format!(
        "SELECT {VENTURE_COLUMNS} FROM ventures WHERE status = 'pending' ORDER BY id"
    )))
    .fetch_all(&state.db)
    .await?;
    let rows = sqlx::query_as::<_, ListingRow>(sqlx::AssertSqlSafe(format!(
        "{LISTING_SELECT} WHERE l.status = 'pending_review' ORDER BY l.updated_at"
    )))
    .fetch_all(&state.db)
    .await?;
    Ok(Json(Queue {
        ventures: ventures.into_iter().map(|v| v.into_api(&state.media)).collect(),
        listings: listings::hydrate(&state.db, &state.media, rows).await?,
    }))
}

#[derive(Deserialize, Default)]
struct Reason {
    reason: Option<String>,
}

async fn set_venture_status(
    state: &AppState,
    admin: &AdminUser,
    id: Uuid,
    status: VentureStatus,
    reason: Option<&str>,
) -> AppResult<Json<Venture>> {
    let mut tx = state.db.begin().await?;
    let row = sqlx::query_as::<_, VentureRow>(sqlx::AssertSqlSafe(format!(
        "UPDATE ventures SET status = $2, status_reason = $3, updated_at = now() WHERE id = $1 RETURNING {VENTURE_COLUMNS}"
    )))
    .bind(id)
    .bind(status)
    .bind(reason)
    .fetch_one(&mut *tx)
    .await?;
    let action = if status == VentureStatus::Approved { "venture.approve" } else { "venture.suspend" };
    audit(&mut tx, Some(admin.0.id), action, "venture", id, reason).await?;
    tx.commit().await?;
    Ok(Json(row.into_api(&state.media)))
}

async fn approve_venture(State(state): State<AppState>, admin: AdminUser, Path(id): Path<Uuid>) -> AppResult<Json<Venture>> {
    set_venture_status(&state, &admin, id, VentureStatus::Approved, None).await
}

/// Suspending hides the venture and all of its listings from the catalogue.
async fn suspend_venture(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    body: Option<Json<Reason>>,
) -> AppResult<Json<Venture>> {
    let reason = body.map(|b| b.0).unwrap_or_default().reason;
    set_venture_status(&state, &admin, id, VentureStatus::Suspended, reason.as_deref()).await
}

async fn approve_listing(State(state): State<AppState>, admin: AdminUser, Path(id): Path<Uuid>) -> AppResult<Json<Listing>> {
    let listing = listings::find(&state.db, id).await?;
    if listing.status != ListingStatus::PendingReview {
        return Err(AppError::conflict("invalid_status", "listing is not awaiting review"));
    }
    if listing.venture_status != VentureStatus::Approved {
        return Err(AppError::conflict("venture_not_approved", "approve the venture before its listings"));
    }
    moderate_listing(&state, &admin, id, ListingStatus::Published, None).await
}

#[derive(Deserialize)]
struct RejectBody {
    reason: String,
}

async fn reject_listing(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<RejectBody>,
) -> AppResult<Json<Listing>> {
    if body.reason.trim().is_empty() {
        return Err(AppError::bad_request("a reason is required so the seller can fix the listing"));
    }
    let listing = listings::find(&state.db, id).await?;
    if !matches!(listing.status, ListingStatus::PendingReview | ListingStatus::Published) {
        return Err(AppError::conflict("invalid_status", "only pending or published listings can be rejected"));
    }
    moderate_listing(&state, &admin, id, ListingStatus::Rejected, Some(body.reason.trim())).await
}

async fn moderate_listing(
    state: &AppState,
    admin: &AdminUser,
    id: Uuid,
    status: ListingStatus,
    reason: Option<&str>,
) -> AppResult<Json<Listing>> {
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE listings SET status = $2, rejection_reason = $3, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(status)
        .bind(reason)
        .execute(&mut *tx)
        .await?;
    let action = if status == ListingStatus::Published { "listing.approve" } else { "listing.reject" };
    audit(&mut tx, Some(admin.0.id), action, "listing", id, reason).await?;
    tx.commit().await?;
    let row = listings::find(&state.db, id).await?;
    let listing = listings::hydrate(&state.db, &state.media, vec![row]).await?.pop().ok_or_else(AppError::not_found)?;
    Ok(Json(listing))
}

#[derive(Deserialize)]
struct AuditQuery {
    target_id: Option<Uuid>,
    cursor: Option<Uuid>,
}

#[derive(Serialize, sqlx::FromRow)]
struct AuditEntry {
    id: Uuid,
    actor_id: Option<Uuid>,
    actor_name: Option<String>,
    action: String,
    target_type: String,
    target_id: Uuid,
    reason: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
}

async fn audit_log(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<AuditQuery>,
) -> AppResult<Json<Vec<AuditEntry>>> {
    let rows = sqlx::query_as::<_, AuditEntry>(
        "SELECT a.id, a.actor_id, u.display_name AS actor_name, a.action, a.target_type, a.target_id, a.reason, a.created_at
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE ($1::uuid IS NULL OR a.target_id = $1)
            AND ($2::uuid IS NULL OR a.id < $2)
          ORDER BY a.id DESC LIMIT 100",
    )
    .bind(q.target_id)
    .bind(q.cursor)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

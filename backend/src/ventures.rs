//! Ventures: the Incubation Hub startups that sell on the marketplace (seller profiles).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::AppState;
use crate::auth::{AuthUser, MaybeUser};
use crate::error::{AppError, AppResult};
use crate::media::Media;
use crate::models::{MemberRole, VentureStatus};
use crate::util::{audit, validate_text};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/ventures", get(list).post(create))
        .route("/ventures/{venture}", get(show).patch(update))
        .route("/ventures/{venture}/members", get(members).post(add_member))
        .route("/ventures/{venture}/members/{user_id}", delete(remove_member))
}

// ------------------------------------------------------------------ access helpers

pub async fn member_role(db: &PgPool, venture_id: Uuid, user_id: Uuid) -> AppResult<Option<MemberRole>> {
    Ok(sqlx::query_scalar("SELECT role FROM venture_members WHERE venture_id = $1 AND user_id = $2")
        .bind(venture_id)
        .bind(user_id)
        .fetch_optional(db)
        .await?)
}

/// The user must belong to the venture. Returns their role.
pub async fn require_member(db: &PgPool, venture_id: Uuid, user: &AuthUser) -> AppResult<MemberRole> {
    member_role(db, venture_id, user.id).await?.ok_or_else(AppError::forbidden)
}

pub async fn require_owner(db: &PgPool, venture_id: Uuid, user: &AuthUser) -> AppResult<()> {
    match require_member(db, venture_id, user).await? {
        MemberRole::Owner => Ok(()),
        MemberRole::Member => Err(AppError::forbidden()),
    }
}

/// Members and admins may see a venture regardless of its status.
pub async fn can_manage(db: &PgPool, venture_id: Uuid, user: Option<&AuthUser>) -> AppResult<bool> {
    match user {
        Some(u) if u.is_admin => Ok(true),
        Some(u) => Ok(member_role(db, venture_id, u.id).await?.is_some()),
        None => Ok(false),
    }
}

// ------------------------------------------------------------------ representation

#[derive(sqlx::FromRow)]
pub struct VentureRow {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub logo_key: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub status: VentureStatus,
    pub status_reason: Option<String>,
    pub created_at: OffsetDateTime,
}

pub const VENTURE_COLUMNS: &str =
    "id, slug, name, description, logo_key, contact_email, contact_phone, status, status_reason, created_at";

#[derive(Serialize)]
pub struct Venture {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub logo_url: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub status: VentureStatus,
    pub status_reason: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl VentureRow {
    pub fn into_api(self, media: &Media) -> Venture {
        Venture {
            logo_url: self.logo_key.as_deref().map(|k| media.public_url(k)),
            id: self.id,
            slug: self.slug,
            name: self.name,
            description: self.description,
            contact_email: self.contact_email,
            contact_phone: self.contact_phone,
            status: self.status,
            status_reason: self.status_reason,
            created_at: self.created_at,
        }
    }
}

/// `{venture}` path segments accept either the UUID or the slug.
pub async fn find(db: &PgPool, key: &str) -> AppResult<VentureRow> {
    let row = match Uuid::parse_str(key) {
        Ok(id) => {
            sqlx::query_as::<_, VentureRow>(sqlx::AssertSqlSafe(format!("SELECT {VENTURE_COLUMNS} FROM ventures WHERE id = $1")))
                .bind(id)
                .fetch_one(db)
                .await?
        }
        Err(_) => {
            sqlx::query_as::<_, VentureRow>(sqlx::AssertSqlSafe(format!("SELECT {VENTURE_COLUMNS} FROM ventures WHERE slug = $1")))
                .bind(key)
                .fetch_one(db)
                .await?
        }
    };
    Ok(row)
}

// ------------------------------------------------------------------ handlers

async fn list(State(state): State<AppState>) -> AppResult<Json<Vec<Venture>>> {
    let rows = sqlx::query_as::<_, VentureRow>(sqlx::AssertSqlSafe(format!(
        "SELECT {VENTURE_COLUMNS} FROM ventures WHERE status = 'approved' ORDER BY name"
    )))
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows.into_iter().map(|r| r.into_api(&state.media)).collect()))
}

async fn show(
    State(state): State<AppState>,
    MaybeUser(user): MaybeUser,
    Path(key): Path<String>,
) -> AppResult<Json<Venture>> {
    let venture = find(&state.db, &key).await?;
    if venture.status != VentureStatus::Approved && !can_manage(&state.db, venture.id, user.as_ref()).await? {
        return Err(AppError::not_found());
    }
    Ok(Json(venture.into_api(&state.media)))
}

#[derive(Deserialize)]
struct CreateVenture {
    name: String,
    slug: Option<String>,
    #[serde(default)]
    description: String,
    contact_email: Option<String>,
    contact_phone: Option<String>,
}

fn slugify(input: &str) -> String {
    let mut slug = String::new();
    for c in input.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    slug.trim_end_matches('-').to_owned()
}

/// Apply to sell on the marketplace. The venture starts as `pending` until Hub staff approve it.
async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateVenture>,
) -> AppResult<(StatusCode, Json<Venture>)> {
    validate_text("name", &body.name, 2, 80)?;
    validate_text("description", &body.description, 0, 4000)?;
    let slug = slugify(body.slug.as_deref().unwrap_or(&body.name));
    if slug.len() < 2 || slug.len() > 60 {
        return Err(AppError::bad_request("slug must be 2-60 characters of a-z, 0-9 and dashes"));
    }

    let id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    let row = sqlx::query_as::<_, VentureRow>(sqlx::AssertSqlSafe(format!(
        "INSERT INTO ventures (id, slug, name, description, contact_email, contact_phone)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING {VENTURE_COLUMNS}"
    )))
    .bind(id)
    .bind(&slug)
    .bind(body.name.trim())
    .bind(body.description.trim())
    .bind(body.contact_email.or_else(|| Some(user.email.clone())))
    .bind(body.contact_phone)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match AppError::from(e) {
        err if err.status == StatusCode::CONFLICT => AppError::conflict("slug_taken", "that venture name is taken"),
        err => err,
    })?;
    sqlx::query("INSERT INTO venture_members (venture_id, user_id, role) VALUES ($1, $2, 'owner')")
        .bind(id)
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    audit(&mut tx, Some(user.id), "venture.apply", "venture", id, None).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(row.into_api(&state.media))))
}

#[derive(Deserialize)]
struct UpdateVenture {
    name: Option<String>,
    description: Option<String>,
    contact_email: Option<String>,
    contact_phone: Option<String>,
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(key): Path<String>,
    Json(body): Json<UpdateVenture>,
) -> AppResult<Json<Venture>> {
    let venture = find(&state.db, &key).await?;
    require_member(&state.db, venture.id, &user).await?;
    if let Some(name) = &body.name {
        validate_text("name", name, 2, 80)?;
    }
    if let Some(description) = &body.description {
        validate_text("description", description, 0, 4000)?;
    }
    let row = sqlx::query_as::<_, VentureRow>(sqlx::AssertSqlSafe(format!(
        "UPDATE ventures SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            contact_email = COALESCE($4, contact_email),
            contact_phone = COALESCE($5, contact_phone),
            updated_at = now()
         WHERE id = $1 RETURNING {VENTURE_COLUMNS}"
    )))
    .bind(venture.id)
    .bind(body.name.as_deref().map(str::trim))
    .bind(body.description.as_deref().map(str::trim))
    .bind(body.contact_email)
    .bind(body.contact_phone)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(row.into_api(&state.media)))
}

#[derive(Serialize, sqlx::FromRow)]
struct Member {
    user_id: Uuid,
    display_name: String,
    email: String,
    role: MemberRole,
}

async fn members(
    State(state): State<AppState>,
    user: AuthUser,
    Path(key): Path<String>,
) -> AppResult<Json<Vec<Member>>> {
    let venture = find(&state.db, &key).await?;
    if !can_manage(&state.db, venture.id, Some(&user)).await? {
        return Err(AppError::forbidden());
    }
    let rows = sqlx::query_as::<_, Member>(
        "SELECT u.id AS user_id, u.display_name, u.email, m.role
           FROM venture_members m JOIN users u ON u.id = m.user_id
          WHERE m.venture_id = $1 ORDER BY m.role, u.display_name",
    )
    .bind(venture.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct AddMember {
    email: String,
    role: Option<MemberRole>,
}

/// Adds a teammate by email. They must have signed in to the marketplace at least once.
async fn add_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path(key): Path<String>,
    Json(body): Json<AddMember>,
) -> AppResult<StatusCode> {
    let venture = find(&state.db, &key).await?;
    require_owner(&state.db, venture.id, &user).await?;
    let member_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE lower(email) = lower($1)")
        .bind(body.email.trim())
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| {
            AppError::new(StatusCode::NOT_FOUND, "user_not_found", "that student has not signed in to the marketplace yet")
        })?;
    sqlx::query(
        "INSERT INTO venture_members (venture_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (venture_id, user_id) DO UPDATE SET role = EXCLUDED.role",
    )
    .bind(venture.id)
    .bind(member_id)
    .bind(body.role.unwrap_or(MemberRole::Member))
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path((key, member_id)): Path<(String, Uuid)>,
) -> AppResult<StatusCode> {
    let venture = find(&state.db, &key).await?;
    // Owners can remove anyone; members can remove themselves.
    if member_id != user.id {
        require_owner(&state.db, venture.id, &user).await?;
    }
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM venture_members WHERE venture_id = $1 AND user_id = $2")
        .bind(venture.id)
        .bind(member_id)
        .execute(&mut *tx)
        .await?;
    let owners: i64 = sqlx::query_scalar("SELECT count(*) FROM venture_members WHERE venture_id = $1 AND role = 'owner'")
        .bind(venture.id)
        .fetch_one(&mut *tx)
        .await?;
    if owners == 0 {
        return Err(AppError::conflict("last_owner", "a venture must keep at least one owner"));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::slugify;

    #[test]
    fn slugs() {
        assert_eq!(slugify("Bob's Bakes & Co."), "bob-s-bakes-co");
        assert_eq!(slugify("  --Tech  Hub-- "), "tech-hub");
    }
}

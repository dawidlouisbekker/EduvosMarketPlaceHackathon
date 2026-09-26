//! ProblemService (proto/incubator/v1/problems.proto).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, put};
use axum::Router;
use serde::Deserialize;
use uuid::Uuid;

use super::proto::{ok, Proto, ProtoResult};
use super::views::{ideas_by_ids, page, parse_id, problems_by_ids, text, ListQuery, IDEA_VISIBLE};
use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::{pb, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/problems", get(list).post(create))
        .route("/problems/search", get(search))
        .route("/problems/{id}", get(detail))
        .route("/problems/{id}/vote", put(vote).delete(unvote))
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(q): Query<ListQuery>,
) -> ProtoResult<pb::ListProblemsResponse> {
    let (limit, offset) = q.window();
    let order = match q.sort.as_deref() {
        Some("top") => "vote_count DESC, created_at DESC",
        _ => "created_at DESC",
    };
    let ids: Vec<Uuid> = sqlx::query_scalar(sql!("SELECT id FROM problems ORDER BY {order}, id LIMIT $1 OFFSET $2"))
        .bind(limit + 1)
        .bind(offset)
        .fetch_all(&state.db)
        .await?;
    let (ids, next_cursor) = page(ids, limit, offset);
    ok(pb::ListProblemsResponse { items: problems_by_ids(&state.db, user.id, &ids).await?, next_cursor })
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
}

async fn search(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(query): Query<SearchQuery>,
) -> ProtoResult<pb::SearchProblemsResponse> {
    let needle = query.q.unwrap_or_default();
    let pattern = format!("%{}%", needle.trim().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    let rows: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, title FROM problems WHERE title ILIKE $1 ORDER BY created_at DESC LIMIT 8")
            .bind(pattern)
            .fetch_all(&state.db)
            .await?;
    ok(pb::SearchProblemsResponse {
        problems: rows.into_iter().map(|(id, title)| pb::ProblemRef { id: id.to_string(), title }).collect(),
    })
}

async fn detail(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ProtoResult<pb::GetProblemResponse> {
    let id = parse_id(&id)?;
    let problem = problems_by_ids(&state.db, user.id, &[id]).await?.pop().ok_or_else(AppError::not_found)?;
    let idea_ids: Vec<Uuid> = sqlx::query_scalar(sql!(
        "SELECT i.id FROM idea_problem_links l JOIN ideas i ON i.id = l.idea_id
          WHERE l.problem_id = $2 AND {IDEA_VISIBLE}
          ORDER BY i.vote_count DESC, i.created_at DESC"
    ))
    .bind(user.id)
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    ok(pb::GetProblemResponse { problem: Some(problem), ideas: ideas_by_ids(&state.db, user.id, &idea_ids).await? })
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Proto(req): Proto<pb::CreateProblemRequest>,
) -> ProtoResult<pb::CreateProblemResponse> {
    let title = text("title", &req.title, 1, 128)?;
    let description = text("description", &req.description, 1, 1024)?;
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO problems (id, user_id, title, description) VALUES ($1, $2, $3, $4)")
        .bind(id)
        .bind(user.id)
        .bind(title)
        .bind(description)
        .execute(&state.db)
        .await?;
    ok(pb::CreateProblemResponse { id: id.to_string() })
}

async fn vote(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<StatusCode> {
    set_vote(&state, user.id, parse_id(&id)?, true).await
}

async fn unvote(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<StatusCode> {
    set_vote(&state, user.id, parse_id(&id)?, false).await
}

/// Adds or removes the viewer's "me too" vote, keeping problems.vote_count in sync.
async fn set_vote(state: &AppState, user: Uuid, problem: Uuid, voted: bool) -> AppResult<StatusCode> {
    let mut tx = state.db.begin().await?;
    let exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM problems WHERE id = $1 FOR UPDATE")
        .bind(problem)
        .fetch_optional(&mut *tx)
        .await?;
    exists.ok_or_else(AppError::not_found)?;
    let changed = if voted {
        sqlx::query("INSERT INTO problem_votes (problem_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
    } else {
        sqlx::query("DELETE FROM problem_votes WHERE problem_id = $1 AND user_id = $2")
    }
    .bind(problem)
    .bind(user)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if changed > 0 {
        sqlx::query("UPDATE problems SET vote_count = vote_count + $2 WHERE id = $1")
            .bind(problem)
            .bind(if voted { 1 } else { -1 })
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

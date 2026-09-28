//! IdeaService (proto/incubator/v1/ideas.proto): ideas, sharing, and threaded comments.

use std::collections::HashSet;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, put};
use axum::Router;
use time::OffsetDateTime;
use uuid::Uuid;

use super::proto::{ok, Proto, ProtoResult};
use super::views::{
    ideas_by_ids, notify, ordered, page, parse_id, parse_ids, parse_optional_id, summaries, text, ts, visibility_db,
    visible_idea, ListQuery, NotificationTarget, IDEA_VISIBLE,
};
use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::{pb, AppState};

const MAX_DEPTH: i16 = 10;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/ideas", get(list).post(create))
        .route("/ideas/{id}", get(detail))
        .route("/ideas/{id}/vote", put(vote).delete(unvote))
        .route("/ideas/{id}/shares", put(set_shares))
        .route("/ideas/{id}/comments", get(list_comments).post(create_comment))
        .route("/comment-types", get(comment_types))
        .route("/comments/{id}/vote", put(vote_comment))
        .route("/comments/{id}", delete(delete_comment))
}

// ---------------------------------------------------------------- ideas

async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<ListQuery>) -> ProtoResult<pb::ListIdeasResponse> {
    let (limit, offset) = q.window();
    let order = match q.sort.as_deref() {
        Some("top") => "i.vote_count DESC, i.created_at DESC",
        _ => "i.created_at DESC",
    };
    let ids: Vec<Uuid> = sqlx::query_scalar(sql!(
        "SELECT i.id FROM ideas i WHERE {IDEA_VISIBLE} ORDER BY {order}, i.id LIMIT $2 OFFSET $3"
    ))
    .bind(user.id)
    .bind(limit + 1)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;
    let (ids, next_cursor) = page(ids, limit, offset);
    ok(pb::ListIdeasResponse { items: ideas_by_ids(&state.db, user.id, &ids).await?, next_cursor })
}

async fn detail(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> ProtoResult<pb::GetIdeaResponse> {
    let id = parse_id(&id)?;
    let owner = visible_idea(&state.db, user.id, id).await?;
    let idea = ideas_by_ids(&state.db, user.id, &[id]).await?.pop().ok_or_else(AppError::not_found)?;
    let is_owner = owner == user.id;
    let shared_with = if is_owner {
        let ids: Vec<Uuid> = sqlx::query_scalar("SELECT user_id FROM idea_shares WHERE idea_id = $1 ORDER BY created_at")
            .bind(id)
            .fetch_all(&state.db)
            .await?;
        ordered(&summaries(&state.db, ids.iter().copied()).await?, ids)
    } else {
        Vec::new()
    };
    ok(pb::GetIdeaResponse { idea: Some(idea), is_owner, shared_with })
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Proto(req): Proto<pb::CreateIdeaRequest>,
) -> ProtoResult<pb::CreateIdeaResponse> {
    let title = text("title", &req.title, 1, 128)?;
    let description = text("description", &req.description, 1, 2048)?;
    let visibility = visibility_db(req.visibility)?;
    let mut links = Vec::with_capacity(req.problems.len());
    let mut seen = HashSet::new();
    for link in &req.problems {
        let problem = parse_id(&link.problem_id)?;
        if seen.insert(problem) {
            links.push((problem, text("problem link description", &link.description, 0, 128)?));
        }
    }

    let id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO ideas (id, user_id, title, description, visibility) VALUES ($1, $2, $3, $4, $5::visibility)")
        .bind(id)
        .bind(user.id)
        .bind(title)
        .bind(description)
        .bind(visibility)
        .execute(&mut *tx)
        .await?;
    for (problem, description) in links {
        sqlx::query("INSERT INTO idea_problem_links (problem_id, idea_id, description) VALUES ($1, $2, $3)")
            .bind(problem)
            .bind(id)
            .bind(description)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    ok(pb::CreateIdeaResponse { id: id.to_string() })
}

async fn vote(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<StatusCode> {
    set_vote(&state, user.id, parse_id(&id)?, true).await
}

async fn unvote(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<StatusCode> {
    set_vote(&state, user.id, parse_id(&id)?, false).await
}

/// Adds or removes the viewer's upvote, keeping ideas.vote_count in sync.
async fn set_vote(state: &AppState, user: Uuid, idea: Uuid, voted: bool) -> AppResult<StatusCode> {
    visible_idea(&state.db, user, idea).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT id FROM ideas WHERE id = $1 FOR UPDATE").bind(idea).execute(&mut *tx).await?;
    let changed = if voted {
        sqlx::query("INSERT INTO idea_votes (idea_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
    } else {
        sqlx::query("DELETE FROM idea_votes WHERE idea_id = $1 AND user_id = $2")
    }
    .bind(idea)
    .bind(user)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if changed > 0 {
        sqlx::query("UPDATE ideas SET vote_count = vote_count + $2 WHERE id = $1")
            .bind(idea)
            .bind(if voted { 1 } else { -1 })
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Replaces the share list. The idea_shares foreign key to user_prospects rejects anyone who isn't a prospect.
async fn set_shares(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Proto(req): Proto<pb::SetIdeaSharesRequest>,
) -> AppResult<StatusCode> {
    let id = parse_id(&id)?;
    if visible_idea(&state.db, user.id, id).await? != user.id {
        return Err(AppError::forbidden());
    }
    let wanted: Vec<Uuid> = parse_ids(&req.user_ids)?.into_iter().collect::<HashSet<_>>().into_iter().collect();

    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM idea_shares WHERE idea_id = $1 AND NOT (user_id = ANY($2))")
        .bind(id)
        .bind(&wanted)
        .execute(&mut *tx)
        .await?;
    for prospect in wanted {
        let added = sqlx::query(
            "INSERT INTO idea_shares (idea_id, owner_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        )
        .bind(id)
        .bind(user.id)
        .bind(prospect)
        .execute(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(ref db) if db.is_foreign_key_violation() => {
                AppError::bad_request("ideas can only be shared with your prospects")
            }
            e => e.into(),
        })?
        .rows_affected();
        if added > 0 {
            let target = NotificationTarget { idea: Some(id), ..Default::default() };
            notify(&mut tx, prospect, user.id, "idea_shared", target).await?;
        }
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------- comments

async fn comment_types(State(state): State<AppState>, _user: AuthUser) -> ProtoResult<pb::ListCommentTypesResponse> {
    let rows: Vec<(Uuid, String, String)> =
        sqlx::query_as("SELECT id, label, color FROM idea_comment_types ORDER BY id").fetch_all(&state.db).await?;
    ok(pb::ListCommentTypesResponse {
        comment_types: rows
            .into_iter()
            .map(|(id, label, color)| pb::CommentType { id: id.to_string(), label, color })
            .collect(),
    })
}

#[derive(sqlx::FromRow)]
struct CommentRow {
    id: Uuid,
    idea_id: Uuid,
    parent_id: Option<Uuid>,
    user_id: Option<Uuid>,
    comment_type: Uuid,
    content: String,
    depth: i16,
    score: i32,
    viewer_vote: i16,
    deleted_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
}

async fn list_comments(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ProtoResult<pb::ListCommentsResponse> {
    let id = parse_id(&id)?;
    visible_idea(&state.db, user.id, id).await?;
    let rows = sqlx::query_as::<_, CommentRow>(
        "SELECT c.id, c.idea_id, c.parent_id, c.user_id, c.comment_type, c.content, c.depth, c.score,
                COALESCE(v.value, 0::int2) AS viewer_vote, c.deleted_at, c.created_at
           FROM idea_comments c
           LEFT JOIN idea_comment_votes v ON v.comment_id = c.id AND v.user_id = $2
          WHERE c.idea_id = $1
          ORDER BY c.created_at",
    )
    .bind(id)
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    let authors =
        summaries(&state.db, rows.iter().filter(|r| r.deleted_at.is_none()).filter_map(|r| r.user_id)).await?;
    ok(pb::ListCommentsResponse {
        comments: rows
            .into_iter()
            .map(|r| {
                let deleted = r.deleted_at.is_some();
                pb::Comment {
                    id: r.id.to_string(),
                    idea_id: r.idea_id.to_string(),
                    parent_id: r.parent_id.map(|p| p.to_string()),
                    author: if deleted { None } else { r.user_id.and_then(|u| authors.get(&u).cloned()) },
                    comment_type: r.comment_type.to_string(),
                    content: if deleted { "[deleted]".to_owned() } else { r.content },
                    depth: r.depth.into(),
                    score: r.score,
                    viewer_vote: r.viewer_vote.into(),
                    deleted_at: r.deleted_at.map(ts),
                    created_at: Some(ts(r.created_at)),
                }
            })
            .collect(),
    })
}

async fn create_comment(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Proto(req): Proto<pb::CreateCommentRequest>,
) -> ProtoResult<pb::CreateCommentResponse> {
    let idea = parse_id(&id)?;
    let owner = visible_idea(&state.db, user.id, idea).await?;
    let content = text("content", &req.content, 1, 512)?;
    let comment_type = parse_id(&req.comment_type)?;
    let parent_id = parse_optional_id(req.parent_id.as_deref())?;

    let mut tx = state.db.begin().await?;
    let parent: Option<(i16, Option<Uuid>)> = match parent_id {
        Some(parent) => Some(
            sqlx::query_as("SELECT depth, user_id FROM idea_comments WHERE id = $1 AND idea_id = $2")
                .bind(parent)
                .bind(idea)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| AppError::bad_request("the comment you replied to does not exist"))?,
        ),
        None => None,
    };
    let depth = parent.map_or(0, |(d, _)| (d + 1).min(MAX_DEPTH));
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO idea_comments (id, idea_id, parent_id, user_id, comment_type, content, depth)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(idea)
    .bind(parent_id)
    .bind(user.id)
    .bind(comment_type)
    .bind(content)
    .bind(depth)
    .execute(&mut *tx)
    .await?;

    let target = || NotificationTarget { idea: Some(idea), comment: Some(id), ..Default::default() };
    match parent {
        Some((_, Some(parent_author))) => notify(&mut tx, parent_author, user.id, "comment_reply", target()).await?,
        Some((_, None)) => {}
        None => notify(&mut tx, owner, user.id, "idea_comment", target()).await?,
    }
    tx.commit().await?;
    ok(pb::CreateCommentResponse { id: id.to_string() })
}

/// Sets the viewer's vote (-1, 0 or 1), keeping idea_comments.score in sync.
async fn vote_comment(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Proto(req): Proto<pb::VoteCommentRequest>,
) -> AppResult<StatusCode> {
    let comment = parse_id(&id)?;
    if !(-1..=1).contains(&req.value) {
        return Err(AppError::bad_request("value must be -1, 0 or 1"));
    }
    let idea: Uuid = sqlx::query_scalar("SELECT idea_id FROM idea_comments WHERE id = $1")
        .bind(comment)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(AppError::not_found)?;
    visible_idea(&state.db, user.id, idea).await?;

    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT id FROM idea_comments WHERE id = $1 FOR UPDATE").bind(comment).execute(&mut *tx).await?;
    let old: i16 = sqlx::query_scalar("DELETE FROM idea_comment_votes WHERE comment_id = $1 AND user_id = $2 RETURNING value")
        .bind(comment)
        .bind(user.id)
        .fetch_optional(&mut *tx)
        .await?
        .unwrap_or(0);
    let new = req.value as i16;
    if new != 0 {
        sqlx::query("INSERT INTO idea_comment_votes (comment_id, user_id, value) VALUES ($1, $2, $3)")
            .bind(comment)
            .bind(user.id)
            .bind(new)
            .execute(&mut *tx)
            .await?;
    }
    if new != old {
        sqlx::query("UPDATE idea_comments SET score = score + $2 WHERE id = $1")
            .bind(comment)
            .bind(i32::from(new - old))
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Soft delete by the author: replies keep their place.
async fn delete_comment(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<StatusCode> {
    let comment = parse_id(&id)?;
    let author: Option<Uuid> = sqlx::query_scalar("SELECT user_id FROM idea_comments WHERE id = $1")
        .bind(comment)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(AppError::not_found)?;
    if author != Some(user.id) {
        return Err(AppError::forbidden());
    }
    sqlx::query("UPDATE idea_comments SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL")
        .bind(comment)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

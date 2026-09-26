//! Shared building blocks: visibility rules, pagination, and turning rows into the feed messages.
//!
//! List endpoints first select the ids they need (filtering, ordering, paging), then hydrate them here
//! with `problems_by_ids` / `ideas_by_ids` / `projects_by_ids`, which keep the order of the ids.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::pb;

/// Ideas the viewer (`$1`) may see: public, their own, or shared with them. Expects the idea aliased `i`.
pub const IDEA_VISIBLE: &str = "(i.visibility = 'public' OR i.user_id = $1
    OR EXISTS (SELECT 1 FROM idea_shares s WHERE s.idea_id = i.id AND s.user_id = $1))";

/// Projects the viewer (`$1`) may see: public, owned, or participating. Expects the project aliased `p`.
pub const PROJECT_VISIBLE: &str = "(p.visibility = 'public' OR p.owner_id = $1
    OR EXISTS (SELECT 1 FROM project_participants x WHERE x.project_id = p.id AND x.user_id = $1))";

// ---------------------------------------------------------------- conversions

pub fn ts(t: OffsetDateTime) -> prost_types::Timestamp {
    prost_types::Timestamp { seconds: t.unix_timestamp(), nanos: t.nanosecond() as i32 }
}

pub fn from_ts(t: &prost_types::Timestamp) -> AppResult<OffsetDateTime> {
    OffsetDateTime::from_unix_timestamp(t.seconds)
        .ok()
        .and_then(|d| d.replace_nanosecond(t.nanos.clamp(0, 999_999_999) as u32).ok())
        .ok_or_else(|| AppError::bad_request("invalid timestamp"))
}

pub fn visibility(db_value: &str) -> i32 {
    match db_value {
        "private" => pb::Visibility::Private,
        _ => pb::Visibility::Public,
    }
    .into()
}

/// Database value for a requested visibility. Unspecified means public.
pub fn visibility_db(value: i32) -> AppResult<&'static str> {
    match pb::Visibility::try_from(value) {
        Ok(pb::Visibility::Private) => Ok("private"),
        Ok(pb::Visibility::Public | pb::Visibility::Unspecified) => Ok("public"),
        Err(_) => Err(AppError::bad_request("invalid visibility")),
    }
}

pub fn parse_id(value: &str) -> AppResult<Uuid> {
    Uuid::parse_str(value).map_err(|_| AppError::bad_request("invalid id"))
}

pub fn parse_ids(values: &[String]) -> AppResult<Vec<Uuid>> {
    values.iter().map(|v| parse_id(v)).collect()
}

pub fn parse_optional_id(value: Option<&str>) -> AppResult<Option<Uuid>> {
    value.filter(|v| !v.is_empty()).map(parse_id).transpose()
}

/// Trims `value` and checks its length (in characters) is within `min..=max`.
pub fn text(field: &str, value: &str, min: usize, max: usize) -> AppResult<String> {
    let value = value.trim();
    let len = value.chars().count();
    if len < min || len > max {
        let message = if min > 0 && len < min {
            format!("{field} is required")
        } else {
            format!("{field} must be at most {max} characters")
        };
        return Err(AppError::bad_request(message));
    }
    Ok(value.to_owned())
}

// ---------------------------------------------------------------- pagination

const DEFAULT_LIMIT: i64 = 8;
const MAX_LIMIT: i64 = 50;

/// `?sort=&cursor=&limit=`. The cursor is an opaque offset.
#[derive(Deserialize)]
pub struct ListQuery {
    pub sort: Option<String>,
    cursor: Option<String>,
    limit: Option<String>,
}

impl ListQuery {
    /// (limit, offset). Fetch `limit + 1` rows and pass them to `page` to know whether there is a next page.
    pub fn window(&self) -> (i64, i64) {
        let limit = self.limit.as_deref().and_then(|l| l.parse().ok()).unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
        let offset = self.cursor.as_deref().and_then(|c| c.parse().ok()).unwrap_or(0i64).max(0);
        (limit, offset)
    }
}

/// Trims the extra row fetched by `window` and returns the next cursor.
pub fn page(mut ids: Vec<Uuid>, limit: i64, offset: i64) -> (Vec<Uuid>, Option<String>) {
    let next = (ids.len() as i64 > limit).then(|| (offset + limit).to_string());
    ids.truncate(limit as usize);
    (ids, next)
}

// ---------------------------------------------------------------- users

#[derive(sqlx::FromRow)]
struct SummaryRow {
    id: Uuid,
    display_name: String,
    avatar_url: Option<String>,
    bio: String,
    is_entrepreneur: bool,
}

pub type Summaries = HashMap<Uuid, pb::UserSummary>;

pub async fn summaries(db: &PgPool, ids: impl IntoIterator<Item = Uuid>) -> AppResult<Summaries> {
    let ids: Vec<Uuid> = ids.into_iter().collect::<HashSet<_>>().into_iter().collect();
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = sqlx::query_as::<_, SummaryRow>(
        "SELECT u.id, u.display_name, u.avatar_url, u.bio,
                EXISTS (SELECT 1 FROM user_entrepreneurial_vouches v WHERE v.user_id = u.id) AS is_entrepreneur
           FROM users u WHERE u.id = ANY($1)",
    )
    .bind(&ids)
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let summary = pb::UserSummary {
                id: r.id.to_string(),
                display_name: r.display_name,
                avatar_url: r.avatar_url,
                bio: r.bio,
                is_entrepreneur: r.is_entrepreneur,
            };
            (r.id, summary)
        })
        .collect())
}

pub async fn summary(db: &PgPool, id: Uuid) -> AppResult<Option<pb::UserSummary>> {
    Ok(summaries(db, [id]).await?.remove(&id))
}

/// Summaries of `ids` in order, skipping unknown users.
pub fn ordered(summaries: &Summaries, ids: impl IntoIterator<Item = Uuid>) -> Vec<pb::UserSummary> {
    ids.into_iter().filter_map(|id| summaries.get(&id).cloned()).collect()
}

// ---------------------------------------------------------------- problems

#[derive(sqlx::FromRow)]
struct ProblemRow {
    id: Uuid,
    user_id: Uuid,
    title: String,
    description: String,
    vote_count: i32,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    viewer_voted: bool,
    idea_count: i32,
}

pub async fn problems_by_ids(db: &PgPool, viewer: Uuid, ids: &[Uuid]) -> AppResult<Vec<pb::Problem>> {
    let rows = sqlx::query_as::<_, ProblemRow>(sql!(
        "SELECT p.id, p.user_id, p.title, p.description, p.vote_count, p.created_at, p.updated_at,
                EXISTS (SELECT 1 FROM problem_votes v WHERE v.problem_id = p.id AND v.user_id = $1) AS viewer_voted,
                (SELECT count(*) FROM idea_problem_links l JOIN ideas i ON i.id = l.idea_id
                  WHERE l.problem_id = p.id AND {IDEA_VISIBLE})::int4 AS idea_count
           FROM problems p WHERE p.id = ANY($2)"
    ))
    .bind(viewer)
    .bind(ids)
    .fetch_all(db)
    .await?;
    let users = summaries(db, rows.iter().map(|r| r.user_id)).await?;
    let mut by_id: HashMap<Uuid, pb::Problem> = rows
        .into_iter()
        .map(|r| {
            let problem = pb::Problem {
                id: r.id.to_string(),
                user_id: r.user_id.to_string(),
                title: r.title,
                description: r.description,
                vote_count: r.vote_count,
                created_at: Some(ts(r.created_at)),
                updated_at: Some(ts(r.updated_at)),
                author: users.get(&r.user_id).cloned(),
                viewer_voted: r.viewer_voted,
                idea_count: r.idea_count,
            };
            (r.id, problem)
        })
        .collect();
    Ok(ids.iter().filter_map(|id| by_id.remove(id)).collect())
}

// ---------------------------------------------------------------- ideas

#[derive(sqlx::FromRow)]
struct IdeaRow {
    id: Uuid,
    user_id: Uuid,
    title: String,
    description: String,
    visibility: String,
    project_id: Option<Uuid>,
    vote_count: i32,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    viewer_voted: bool,
    comment_count: i32,
    project_name: Option<String>,
}

#[derive(sqlx::FromRow)]
struct LinkRow {
    idea_id: Uuid,
    problem_id: Uuid,
    problem_title: String,
    description: String,
}

/// Ideas by id. Does not check visibility: callers select only ids the viewer may see.
pub async fn ideas_by_ids(db: &PgPool, viewer: Uuid, ids: &[Uuid]) -> AppResult<Vec<pb::Idea>> {
    let rows = sqlx::query_as::<_, IdeaRow>(
        "SELECT i.id, i.user_id, i.title, i.description, i.visibility::text AS visibility, i.project_id,
                i.vote_count, i.created_at, i.updated_at,
                EXISTS (SELECT 1 FROM idea_votes v WHERE v.idea_id = i.id AND v.user_id = $1) AS viewer_voted,
                (SELECT count(*) FROM idea_comments c WHERE c.idea_id = i.id AND c.deleted_at IS NULL)::int4 AS comment_count,
                pr.name AS project_name
           FROM ideas i LEFT JOIN projects pr ON pr.id = i.project_id
          WHERE i.id = ANY($2)",
    )
    .bind(viewer)
    .bind(ids)
    .fetch_all(db)
    .await?;
    let links = sqlx::query_as::<_, LinkRow>(
        "SELECT l.idea_id, l.problem_id, p.title AS problem_title, l.description
           FROM idea_problem_links l JOIN problems p ON p.id = l.problem_id
          WHERE l.idea_id = ANY($1)
          ORDER BY p.created_at",
    )
    .bind(ids)
    .fetch_all(db)
    .await?;
    let mut links_by_idea: HashMap<Uuid, Vec<pb::IdeaProblemLink>> = HashMap::new();
    for l in links {
        links_by_idea.entry(l.idea_id).or_default().push(pb::IdeaProblemLink {
            problem_id: l.problem_id.to_string(),
            problem_title: l.problem_title,
            description: l.description,
        });
    }
    let users = summaries(db, rows.iter().map(|r| r.user_id)).await?;
    let mut by_id: HashMap<Uuid, pb::Idea> = rows
        .into_iter()
        .map(|r| {
            let idea = pb::Idea {
                id: r.id.to_string(),
                user_id: r.user_id.to_string(),
                title: r.title,
                description: r.description,
                visibility: visibility(&r.visibility),
                project_id: r.project_id.map(|p| p.to_string()),
                vote_count: r.vote_count,
                created_at: Some(ts(r.created_at)),
                updated_at: Some(ts(r.updated_at)),
                author: users.get(&r.user_id).cloned(),
                viewer_voted: r.viewer_voted,
                comment_count: r.comment_count,
                problems: links_by_idea.remove(&r.id).unwrap_or_default(),
                project_name: r.project_name,
            };
            (r.id, idea)
        })
        .collect();
    Ok(ids.iter().filter_map(|id| by_id.remove(id)).collect())
}

/// Whether the viewer may see the idea. `None` when it doesn't exist.
pub async fn idea_access(db: &PgPool, viewer: Uuid, idea: Uuid) -> AppResult<Option<(bool, Uuid)>> {
    let row: Option<(bool, Uuid)> =
        sqlx::query_as(sql!("SELECT {IDEA_VISIBLE}, i.user_id FROM ideas i WHERE i.id = $2"))
            .bind(viewer)
            .bind(idea)
            .fetch_optional(db)
            .await?;
    Ok(row)
}

/// The idea's owner, or 404 when it doesn't exist or the viewer may not see it.
pub async fn visible_idea(db: &PgPool, viewer: Uuid, idea: Uuid) -> AppResult<Uuid> {
    match idea_access(db, viewer, idea).await? {
        Some((true, owner)) => Ok(owner),
        _ => Err(AppError::not_found()),
    }
}

// ---------------------------------------------------------------- projects

#[derive(sqlx::FromRow)]
struct ProjectRow {
    id: Uuid,
    owner_id: Uuid,
    name: String,
    description: String,
    visibility: String,
    deadline: Option<OffsetDateTime>,
    show_media: bool,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    task_total: i32,
    task_done: i32,
    media_count: i32,
}

/// Projects by id. Does not check visibility: callers select only ids the viewer may see.
pub async fn projects_by_ids(db: &PgPool, ids: &[Uuid]) -> AppResult<Vec<pb::Project>> {
    let rows = sqlx::query_as::<_, ProjectRow>(
        "SELECT p.id, p.owner_id, p.name, p.description, p.visibility::text AS visibility, p.deadline,
                p.show_media, p.created_at, p.updated_at,
                (SELECT count(*) FROM project_tasks t WHERE t.project_id = p.id)::int4 AS task_total,
                (SELECT count(*) FROM project_tasks t WHERE t.project_id = p.id AND t.completed)::int4 AS task_done,
                (CASE WHEN p.show_media
                      THEN (SELECT count(*) FROM project_media m WHERE m.project_id = p.id) ELSE 0 END)::int4 AS media_count
           FROM projects p WHERE p.id = ANY($1)",
    )
    .bind(ids)
    .fetch_all(db)
    .await?;
    let participants: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT project_id, user_id FROM project_participants WHERE project_id = ANY($1) ORDER BY created_at",
    )
    .bind(ids)
    .fetch_all(db)
    .await?;
    let open_roles: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT r.project_id, r.name FROM project_roles r
          WHERE r.project_id = ANY($1)
            AND NOT EXISTS (SELECT 1 FROM project_participant_roles a WHERE a.role_id = r.id)
          ORDER BY r.created_at, r.name",
    )
    .bind(ids)
    .fetch_all(db)
    .await?;

    let users = summaries(db, rows.iter().map(|r| r.owner_id).chain(participants.iter().map(|p| p.1))).await?;
    let mut by_id: HashMap<Uuid, pb::Project> = rows
        .into_iter()
        .map(|r| {
            let project = pb::Project {
                id: r.id.to_string(),
                owner_id: r.owner_id.to_string(),
                name: r.name,
                description: r.description,
                visibility: visibility(&r.visibility),
                deadline: r.deadline.map(ts),
                show_media: r.show_media,
                created_at: Some(ts(r.created_at)),
                updated_at: Some(ts(r.updated_at)),
                owner: users.get(&r.owner_id).cloned(),
                participants: ordered(
                    &users,
                    participants.iter().filter(|p| p.0 == r.id && p.1 != r.owner_id).map(|p| p.1),
                ),
                task_total: r.task_total,
                task_done: r.task_done,
                open_roles: open_roles.iter().filter(|o| o.0 == r.id).map(|o| o.1.clone()).collect(),
                media_count: r.media_count,
            };
            (r.id, project)
        })
        .collect();
    Ok(ids.iter().filter_map(|id| by_id.remove(id)).collect())
}

/// The project's owner, or 404 when it doesn't exist or the viewer may not see it.
pub async fn visible_project(db: &PgPool, viewer: Uuid, project: Uuid) -> AppResult<Uuid> {
    let row: Option<(bool, Uuid)> =
        sqlx::query_as(sql!("SELECT {PROJECT_VISIBLE}, p.owner_id FROM projects p WHERE p.id = $2"))
            .bind(viewer)
            .bind(project)
            .fetch_optional(db)
            .await?;
    match row {
        Some((true, owner)) => Ok(owner),
        _ => Err(AppError::not_found()),
    }
}

/// For owner-only routes: 404 when the viewer may not see the project, 403 when they don't own it.
pub async fn owned_project(db: &PgPool, viewer: Uuid, project: Uuid) -> AppResult<()> {
    if visible_project(db, viewer, project).await? == viewer { Ok(()) } else { Err(AppError::forbidden()) }
}

// ---------------------------------------------------------------- notifications

/// Target of a notification; which fields are set depends on the kind (see notification_kind in the schema).
#[derive(Default)]
pub struct NotificationTarget {
    pub idea: Option<Uuid>,
    pub project: Option<Uuid>,
    pub comment: Option<Uuid>,
}

/// Inserts a notification, inside the caller's transaction. Nobody is notified about their own actions.
pub async fn notify(
    conn: &mut sqlx::PgConnection,
    recipient: Uuid,
    actor: Uuid,
    kind: &str,
    target: NotificationTarget,
) -> AppResult<()> {
    if recipient == actor {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO notifications (id, user_id, actor_id, kind, idea_id, project_id, comment_id)
         VALUES ($1, $2, $3, $4::notification_kind, $5, $6, $7)",
    )
    .bind(Uuid::now_v7())
    .bind(recipient)
    .bind(actor)
    .bind(kind)
    .bind(target.idea)
    .bind(target.project)
    .bind(target.comment)
    .execute(conn)
    .await?;
    Ok(())
}

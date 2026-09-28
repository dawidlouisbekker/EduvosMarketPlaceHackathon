//! Owner-only ProjectService routes (proto/incubator/v1/projects.proto): project details, videos, categories,
//! roles, tasks and the team. Every handler starts with `owned`, which returns 404/403 for anyone but the owner.

use std::collections::HashSet;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, patch, post, put};
use axum::Router;
use uuid::Uuid;

use super::proto::{ok, Proto, ProtoResult};
use super::views::{from_ts, notify, owned_project, parse_id, parse_ids, text, visibility_db, NotificationTarget};
use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::{pb, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/projects/{id}", patch(update_project).delete(delete_project))
        .route("/projects/{id}/media", post(add_media))
        .route("/projects/{id}/media/{media_id}", delete(remove_media))
        .route("/projects/{id}/categories", post(add_category))
        .route("/projects/{id}/categories/{category_id}", patch(rename_category).delete(remove_category))
        .route("/projects/{id}/roles", post(add_role))
        .route("/projects/{id}/roles/{role_id}", patch(update_role).delete(remove_role))
        .route("/projects/{id}/tasks", post(add_task))
        .route("/projects/{id}/tasks/order", put(reorder_tasks))
        .route("/projects/{id}/tasks/{task_id}", delete(remove_task))
        .route("/projects/{id}/participants/{user_id}", delete(remove_participant))
        .route("/projects/{id}/participants/{user_id}/roles", put(set_participant_roles))
        .route("/projects/{id}/invites", post(invite))
        .route("/projects/{id}/invites/{user_id}", delete(cancel_invite))
}

/// The project id, if the viewer owns it.
async fn owned(state: &AppState, user: &AuthUser, id: &str) -> AppResult<Uuid> {
    let project = parse_id(id)?;
    owned_project(&state.db, user.id, project).await?;
    Ok(project)
}

/// Turns a unique violation (a duplicate name within the project) into a readable 409.
fn duplicate(what: &'static str) -> impl FnOnce(sqlx::Error) -> AppError {
    move |e| match e {
        sqlx::Error::Database(ref db) if db.is_unique_violation() => {
            AppError::conflict("already_exists", format!("this project already has a {what} with that name"))
        }
        e => e.into(),
    }
}

fn not_found_unless(affected: u64) -> AppResult<StatusCode> {
    if affected == 0 { Err(AppError::not_found()) } else { Ok(StatusCode::NO_CONTENT) }
}

// ---------------------------------------------------------------- details

async fn update_project(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Proto(req): Proto<pb::UpdateProjectRequest>,
) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    let name = req.name.as_deref().map(|n| text("name", n, 1, 128)).transpose()?;
    let description = req.description.as_deref().map(|d| text("description", d, 0, 2048)).transpose()?;
    let visibility = match req.visibility {
        0 => None,
        v => Some(visibility_db(v)?),
    };
    let deadline = req.deadline.as_ref().map(from_ts).transpose()?;
    sqlx::query(
        "UPDATE projects
            SET name = COALESCE($2, name), description = COALESCE($3, description),
                visibility = COALESCE($4::visibility, visibility),
                deadline = CASE WHEN $6 THEN NULL ELSE COALESCE($5, deadline) END,
                show_media = COALESCE($7, show_media), updated_at = now()
          WHERE id = $1",
    )
    .bind(project)
    .bind(name)
    .bind(description)
    .bind(visibility)
    .bind(deadline)
    .bind(req.clear_deadline)
    .bind(req.show_media)
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Foreign keys do the rest: ideas are unlinked, skill vouches lose their role but keep counting.
async fn delete_project(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    sqlx::query("DELETE FROM projects WHERE id = $1").bind(project).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------- videos

const YOUTUBE_HOSTS: [&str; 4] = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"];

fn youtube_url(value: &str) -> AppResult<String> {
    let value = text("url", value, 1, 2048)?;
    let url = url::Url::parse(&value).map_err(|_| AppError::bad_request("url is not a valid link"))?;
    let is_youtube = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| YOUTUBE_HOSTS.contains(&host));
    if !is_youtube {
        return Err(AppError::bad_request("only YouTube links are supported"));
    }
    Ok(value)
}

async fn add_media(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Proto(req): Proto<pb::AddMediaRequest>,
) -> ProtoResult<pb::AddMediaResponse> {
    let project = owned(&state, &user, &id).await?;
    let url = youtube_url(&req.url)?;
    let media = Uuid::now_v7();
    sqlx::query("INSERT INTO project_media (id, project_id, url) VALUES ($1, $2, $3)")
        .bind(media)
        .bind(project)
        .bind(url)
        .execute(&state.db)
        .await?;
    ok(pb::AddMediaResponse { id: media.to_string() })
}

async fn remove_media(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, media_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    let removed = sqlx::query("DELETE FROM project_media WHERE id = $1 AND project_id = $2")
        .bind(parse_id(&media_id)?)
        .bind(project)
        .execute(&state.db)
        .await?
        .rows_affected();
    not_found_unless(removed)
}

// ---------------------------------------------------------------- categories

async fn add_category(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Proto(req): Proto<pb::AddCategoryRequest>,
) -> ProtoResult<pb::AddCategoryResponse> {
    let project = owned(&state, &user, &id).await?;
    let name = text("name", &req.name, 1, 64)?;
    let category = Uuid::now_v7();
    sqlx::query("INSERT INTO project_categories (id, project_id, name) VALUES ($1, $2, $3)")
        .bind(category)
        .bind(project)
        .bind(name)
        .execute(&state.db)
        .await
        .map_err(duplicate("category"))?;
    ok(pb::AddCategoryResponse { id: category.to_string() })
}

async fn rename_category(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, category_id)): Path<(String, String)>,
    Proto(req): Proto<pb::RenameCategoryRequest>,
) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    let name = text("name", &req.name, 1, 64)?;
    let renamed = sqlx::query("UPDATE project_categories SET name = $3 WHERE id = $1 AND project_id = $2")
        .bind(parse_id(&category_id)?)
        .bind(project)
        .bind(name)
        .execute(&state.db)
        .await
        .map_err(duplicate("category"))?
        .rows_affected();
    not_found_unless(renamed)
}

/// Refused while it is the only category of a task: every task needs at least one.
async fn remove_category(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, category_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    let category = parse_id(&category_id)?;
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT id FROM projects WHERE id = $1 FOR UPDATE").bind(project).execute(&mut *tx).await?;
    let sole: bool = sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM project_task_categories tc
              WHERE tc.project_id = $1 AND tc.category_id = $2
                AND NOT EXISTS (SELECT 1 FROM project_task_categories o
                                 WHERE o.task_id = tc.task_id AND o.category_id <> $2))",
    )
    .bind(project)
    .bind(category)
    .fetch_one(&mut *tx)
    .await?;
    if sole {
        return Err(AppError::conflict(
            "category_in_use",
            "a task only has this category; give it another category first",
        ));
    }
    let removed = sqlx::query("DELETE FROM project_categories WHERE id = $1 AND project_id = $2")
        .bind(category)
        .bind(project)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    tx.commit().await?;
    not_found_unless(removed)
}

// ---------------------------------------------------------------- roles

async fn insert_role_categories(
    conn: &mut sqlx::PgConnection,
    project: Uuid,
    role: Uuid,
    categories: &[Uuid],
) -> AppResult<()> {
    for category in categories.iter().collect::<HashSet<_>>() {
        sqlx::query("INSERT INTO project_role_categories (project_id, role_id, category_id) VALUES ($1, $2, $3)")
            .bind(project)
            .bind(role)
            .bind(category)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

async fn add_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Proto(req): Proto<pb::AddRoleRequest>,
) -> ProtoResult<pb::AddRoleResponse> {
    let project = owned(&state, &user, &id).await?;
    let name = text("name", &req.name, 1, 64)?;
    let categories = parse_ids(&req.category_ids)?;
    let role = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO project_roles (id, project_id, name) VALUES ($1, $2, $3)")
        .bind(role)
        .bind(project)
        .bind(name)
        .execute(&mut *tx)
        .await
        .map_err(duplicate("role"))?;
    insert_role_categories(&mut tx, project, role, &categories).await?;
    tx.commit().await?;
    ok(pb::AddRoleResponse { id: role.to_string() })
}

async fn update_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, role_id)): Path<(String, String)>,
    Proto(req): Proto<pb::UpdateRoleRequest>,
) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    let role = parse_id(&role_id)?;
    let name = req.name.as_deref().map(|n| text("name", n, 1, 64)).transpose()?;
    let categories = if req.set_categories { Some(parse_ids(&req.category_ids)?) } else { None };

    let mut tx = state.db.begin().await?;
    let found = sqlx::query("UPDATE project_roles SET name = COALESCE($3, name) WHERE id = $1 AND project_id = $2")
        .bind(role)
        .bind(project)
        .bind(name)
        .execute(&mut *tx)
        .await
        .map_err(duplicate("role"))?
        .rows_affected();
    if found == 0 {
        return Err(AppError::not_found());
    }
    if let Some(categories) = categories {
        sqlx::query("DELETE FROM project_role_categories WHERE project_id = $1 AND role_id = $2")
            .bind(project)
            .bind(role)
            .execute(&mut *tx)
            .await?;
        insert_role_categories(&mut tx, project, role, &categories).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Also unassigns it (cascade); skill vouches based on it keep counting without the role.
async fn remove_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, role_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    let removed = sqlx::query("DELETE FROM project_roles WHERE id = $1 AND project_id = $2")
        .bind(parse_id(&role_id)?)
        .bind(project)
        .execute(&state.db)
        .await?
        .rows_affected();
    not_found_unless(removed)
}

// ---------------------------------------------------------------- tasks

/// Tags a task with categories of the same project (the composite foreign keys reject others).
pub async fn insert_task_categories(
    conn: &mut sqlx::PgConnection,
    project: Uuid,
    task: Uuid,
    categories: &[Uuid],
) -> AppResult<()> {
    for category in categories.iter().collect::<HashSet<_>>() {
        sqlx::query("INSERT INTO project_task_categories (project_id, task_id, category_id) VALUES ($1, $2, $3)")
            .bind(project)
            .bind(task)
            .bind(category)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

async fn add_task(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Proto(req): Proto<pb::AddTaskRequest>,
) -> ProtoResult<pb::AddTaskResponse> {
    let project = owned(&state, &user, &id).await?;
    let description = text("description", &req.description, 1, 1024)?;
    let deadline = from_ts(req.deadline.as_ref().ok_or_else(|| AppError::bad_request("deadline is required"))?)?;
    let categories = parse_ids(&req.category_ids)?;
    if categories.is_empty() {
        return Err(AppError::bad_request("a task needs at least one category"));
    }

    let task = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    // Serialises appends so two tasks can't get the same position.
    sqlx::query("SELECT id FROM projects WHERE id = $1 FOR UPDATE").bind(project).execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO project_tasks (id, project_id, position, description, deadline)
         VALUES ($1, $2, (SELECT COALESCE(max(position) + 1, 0) FROM project_tasks WHERE project_id = $2), $3, $4)",
    )
    .bind(task)
    .bind(project)
    .bind(description)
    .bind(deadline)
    .execute(&mut *tx)
    .await?;
    insert_task_categories(&mut tx, project, task, &categories).await?;
    tx.commit().await?;
    ok(pb::AddTaskResponse { id: task.to_string() })
}

/// Closes the gap so positions stay 0..n-1.
async fn remove_task(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, task_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT id FROM projects WHERE id = $1 FOR UPDATE").bind(project).execute(&mut *tx).await?;
    let position: i32 = sqlx::query_scalar("DELETE FROM project_tasks WHERE id = $1 AND project_id = $2 RETURNING position")
        .bind(parse_id(&task_id)?)
        .bind(project)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(AppError::not_found)?;
    sqlx::query("UPDATE project_tasks SET position = position - 1 WHERE project_id = $1 AND position > $2")
        .bind(project)
        .bind(position)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The UNIQUE (project_id, position) constraint is deferred, so positions can be rewritten in any order.
async fn reorder_tasks(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Proto(req): Proto<pb::ReorderTasksRequest>,
) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    let order = parse_ids(&req.task_ids)?;
    let mut tx = state.db.begin().await?;
    let current: HashSet<Uuid> =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM project_tasks WHERE project_id = $1 FOR UPDATE")
            .bind(project)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .collect();
    let requested: HashSet<Uuid> = order.iter().copied().collect();
    if requested.len() != order.len() || requested != current {
        return Err(AppError::bad_request("task_ids must list every task of the project exactly once"));
    }
    for (position, task) in order.iter().enumerate() {
        sqlx::query("UPDATE project_tasks SET position = $3, updated_at = now() WHERE id = $1 AND project_id = $2")
            .bind(task)
            .bind(project)
            .bind(position as i32)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------- team

async fn is_participant(conn: &mut sqlx::PgConnection, project: Uuid, user: Uuid) -> AppResult<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM project_participants WHERE project_id = $1 AND user_id = $2)")
        .bind(project)
        .bind(user)
        .fetch_one(conn)
        .await?)
}

/// Only removes the roles that are no longer wanted: deleting an assignment clears the role from skill vouches
/// based on it, so kept roles must not be deleted and re-inserted.
async fn set_participant_roles(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, user_id)): Path<(String, String)>,
    Proto(req): Proto<pb::SetParticipantRolesRequest>,
) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    let member = parse_id(&user_id)?;
    let roles: Vec<Uuid> = parse_ids(&req.role_ids)?.into_iter().collect::<HashSet<_>>().into_iter().collect();
    let mut tx = state.db.begin().await?;
    if !is_participant(&mut tx, project, member).await? {
        return Err(AppError::not_found());
    }
    sqlx::query(
        "DELETE FROM project_participant_roles WHERE project_id = $1 AND user_id = $2 AND NOT (role_id = ANY($3))",
    )
    .bind(project)
    .bind(member)
    .bind(&roles)
    .execute(&mut *tx)
    .await?;
    for role in roles {
        sqlx::query(
            "INSERT INTO project_participant_roles (project_id, user_id, role_id) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING",
        )
        .bind(project)
        .bind(member)
        .bind(role)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_participant(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, user_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    let member = parse_id(&user_id)?;
    if member == user.id {
        return Err(AppError::bad_request("the owner can't be removed from their project"));
    }
    let removed = sqlx::query("DELETE FROM project_participants WHERE project_id = $1 AND user_id = $2")
        .bind(project)
        .bind(member)
        .execute(&state.db)
        .await?
        .rows_affected();
    not_found_unless(removed)
}

async fn invite(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Proto(req): Proto<pb::InviteRequest>,
) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    let invitee = parse_id(&req.user_id)?;
    let mut tx = state.db.begin().await?;
    let prospect: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM user_prospects WHERE owner_id = $1 AND prospect_id = $2)")
            .bind(user.id)
            .bind(invitee)
            .fetch_one(&mut *tx)
            .await?;
    if !prospect {
        return Err(AppError::bad_request("you can only invite your prospects"));
    }
    if is_participant(&mut tx, project, invitee).await? {
        return Err(AppError::conflict("already_participant", "they are already on the team"));
    }
    let added = sqlx::query("INSERT INTO project_invites (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(project)
        .bind(invitee)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if added > 0 {
        let target = NotificationTarget { project: Some(project), ..Default::default() };
        notify(&mut tx, invitee, user.id, "project_invite", target).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn cancel_invite(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, user_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let project = owned(&state, &user, &id).await?;
    let removed = sqlx::query("DELETE FROM project_invites WHERE project_id = $1 AND user_id = $2")
        .bind(project)
        .bind(parse_id(&user_id)?)
        .execute(&state.db)
        .await?
        .rows_affected();
    not_found_unless(removed)
}

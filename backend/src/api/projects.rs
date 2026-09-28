//! ProjectService (proto/incubator/v1/projects.proto).

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::Router;
use time::OffsetDateTime;
use uuid::Uuid;

use super::proto::{ok, Proto, ProtoResult};
use super::views::{
    from_ts, notify, ordered, page, parse_id, parse_ids, parse_optional_id, projects_by_ids, summaries, text, ts,
    visibility_db, visible_project, ListQuery, NotificationTarget, PROJECT_VISIBLE,
};
use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::{pb, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/projects", get(list).post(create))
        .route("/projects/{id}", get(detail))
        .route("/projects/{id}/requests/me", post(request_to_join).delete(cancel_join_request))
        .route("/projects/{id}/requests/{user_id}/{decision}", post(respond_to_join_request))
        .route("/projects/{id}/invites/me/{decision}", post(respond_to_invite))
        .route("/projects/{id}/tasks/{task_id}", patch(update_task))
        .merge(super::project_editor::router())
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(q): Query<ListQuery>,
) -> ProtoResult<pb::ListProjectsResponse> {
    let (limit, offset) = q.window();
    let filter = match q.sort.as_deref() {
        Some("open_roles") => {
            "AND EXISTS (SELECT 1 FROM project_roles r WHERE r.project_id = p.id
                 AND NOT EXISTS (SELECT 1 FROM project_participant_roles a WHERE a.role_id = r.id))"
        }
        _ => "",
    };
    let ids: Vec<Uuid> = sqlx::query_scalar(sql!(
        "SELECT p.id FROM projects p WHERE {PROJECT_VISIBLE} {filter}
          ORDER BY p.created_at DESC, p.id LIMIT $2 OFFSET $3"
    ))
    .bind(user.id)
    .bind(limit + 1)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;
    let (ids, next_cursor) = page(ids, limit, offset);
    ok(pb::ListProjectsResponse { items: projects_by_ids(&state.db, &ids).await?, next_cursor })
}

#[derive(sqlx::FromRow)]
struct Relation {
    participant: bool,
    invited: bool,
    requested: bool,
}

#[derive(sqlx::FromRow)]
struct TaskRow {
    id: Uuid,
    position: i32,
    description: String,
    deadline: OffsetDateTime,
    completed: bool,
}

async fn detail(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ProtoResult<pb::GetProjectResponse> {
    let id = parse_id(&id)?;
    let db = &state.db;
    let owner = visible_project(db, user.id, id).await?;
    let project = projects_by_ids(db, &[id]).await?.pop().ok_or_else(AppError::not_found)?;

    let rel = sqlx::query_as::<_, Relation>(
        "SELECT EXISTS (SELECT 1 FROM project_participants WHERE project_id = $1 AND user_id = $2) AS participant,
                EXISTS (SELECT 1 FROM project_invites WHERE project_id = $1 AND user_id = $2) AS invited,
                EXISTS (SELECT 1 FROM project_participant_requests WHERE project_id = $1 AND user_id = $2) AS requested",
    )
    .bind(id)
    .bind(user.id)
    .fetch_one(db)
    .await?;
    let is_owner = owner == user.id;
    let viewer_relation = if is_owner {
        pb::ViewerRelation::Owner
    } else if rel.participant {
        pb::ViewerRelation::Participant
    } else if rel.invited {
        pb::ViewerRelation::Invited
    } else if rel.requested {
        pb::ViewerRelation::Requested
    } else {
        pb::ViewerRelation::None
    };

    let categories: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, name FROM project_categories WHERE project_id = $1 ORDER BY created_at, name")
            .bind(id)
            .fetch_all(db)
            .await?;
    let role_categories: Vec<(Uuid, Uuid)> =
        sqlx::query_as("SELECT role_id, category_id FROM project_role_categories WHERE project_id = $1")
            .bind(id)
            .fetch_all(db)
            .await?;
    let roles: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, name FROM project_roles WHERE project_id = $1 ORDER BY created_at, name")
            .bind(id)
            .fetch_all(db)
            .await?;
    let tasks = sqlx::query_as::<_, TaskRow>(
        "SELECT id, position, description, deadline, completed FROM project_tasks WHERE project_id = $1 ORDER BY position",
    )
    .bind(id)
    .fetch_all(db)
    .await?;
    let task_categories: Vec<(Uuid, Uuid)> =
        sqlx::query_as("SELECT task_id, category_id FROM project_task_categories WHERE project_id = $1")
            .bind(id)
            .fetch_all(db)
            .await?;
    let members: Vec<Uuid> =
        sqlx::query_scalar("SELECT user_id FROM project_participants WHERE project_id = $1 ORDER BY created_at")
            .bind(id)
            .fetch_all(db)
            .await?;
    let member_roles: Vec<(Uuid, Uuid)> =
        sqlx::query_as("SELECT user_id, role_id FROM project_participant_roles WHERE project_id = $1 ORDER BY created_at")
            .bind(id)
            .fetch_all(db)
            .await?;
    // The owner always gets the videos, to manage them while they're hidden.
    let media: Vec<(Uuid, String)> = if project.show_media || is_owner {
        sqlx::query_as("SELECT id, url FROM project_media WHERE project_id = $1 ORDER BY created_at")
            .bind(id)
            .fetch_all(db)
            .await?
    } else {
        Vec::new()
    };
    let requesters: Vec<Uuid> = if is_owner {
        sqlx::query_scalar("SELECT user_id FROM project_participant_requests WHERE project_id = $1 ORDER BY created_at")
            .bind(id)
            .fetch_all(db)
            .await?
    } else {
        Vec::new()
    };
    let invitees: Vec<Uuid> = if is_owner {
        sqlx::query_scalar("SELECT user_id FROM project_invites WHERE project_id = $1 ORDER BY created_at")
            .bind(id)
            .fetch_all(db)
            .await?
    } else {
        Vec::new()
    };
    let source_idea: Option<(Uuid, String)> =
        sqlx::query_as("SELECT id, title FROM ideas WHERE project_id = $1 ORDER BY created_at LIMIT 1")
            .bind(id)
            .fetch_optional(db)
            .await?;

    let group = |pairs: &[(Uuid, Uuid)]| {
        let mut map: HashMap<Uuid, Vec<String>> = HashMap::new();
        for (key, value) in pairs {
            map.entry(*key).or_default().push(value.to_string());
        }
        map
    };
    let mut categories_of_role = group(&role_categories);
    let mut categories_of_task = group(&task_categories);
    let mut roles_of_member = group(&member_roles);
    // Owner first; owners are also participants, so they appear once, with their roles.
    let team_ids: Vec<Uuid> = std::iter::once(owner).chain(members.into_iter().filter(|m| *m != owner)).collect();
    let users = summaries(db, team_ids.iter().chain(&requesters).chain(&invitees).copied()).await?;

    ok(pb::GetProjectResponse {
        project: Some(project),
        viewer_relation: viewer_relation.into(),
        categories: categories
            .into_iter()
            .map(|(id, name)| pb::ProjectCategory { id: id.to_string(), name })
            .collect(),
        roles: roles
            .into_iter()
            .map(|(id, name)| pb::ProjectRole {
                id: id.to_string(),
                name,
                category_ids: categories_of_role.remove(&id).unwrap_or_default(),
            })
            .collect(),
        tasks: tasks
            .into_iter()
            .map(|t| pb::ProjectTask {
                id: t.id.to_string(),
                position: t.position,
                description: t.description,
                deadline: Some(ts(t.deadline)),
                completed: t.completed,
                category_ids: categories_of_task.remove(&t.id).unwrap_or_default(),
            })
            .collect(),
        team: team_ids
            .into_iter()
            .filter_map(|member| {
                let user = users.get(&member).cloned()?;
                Some(pb::ProjectParticipant { user: Some(user), role_ids: roles_of_member.remove(&member).unwrap_or_default() })
            })
            .collect(),
        media: media.into_iter().map(|(id, url)| pb::ProjectMedia { id: id.to_string(), url }).collect(),
        join_requests: ordered(&users, requesters),
        invites: ordered(&users, invitees),
        source_idea: source_idea.map(|(id, title)| pb::IdeaRef { id: id.to_string(), title }),
    })
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Proto(req): Proto<pb::CreateProjectRequest>,
) -> ProtoResult<pb::CreateProjectResponse> {
    let name = text("name", &req.name, 1, 128)?;
    let description = text("description", &req.description, 0, 2048)?;
    let visibility = visibility_db(req.visibility)?;
    let deadline = req.deadline.as_ref().map(from_ts).transpose()?;
    let idea = parse_optional_id(req.idea_id.as_deref())?;

    let id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO projects (id, owner_id, name, description, visibility, deadline)
         VALUES ($1, $2, $3, $4, $5::visibility, $6)",
    )
    .bind(id)
    .bind(user.id)
    .bind(name)
    .bind(description)
    .bind(visibility)
    .bind(deadline)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO project_participants (project_id, user_id) VALUES ($1, $2)")
        .bind(id)
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    if let Some(idea) = idea {
        let linked = sqlx::query("UPDATE ideas SET project_id = $1, updated_at = now() WHERE id = $2 AND user_id = $3")
            .bind(id)
            .bind(idea)
            .bind(user.id)
            .execute(&mut *tx)
            .await?
            .rows_affected();
        if linked == 0 {
            return Err(AppError::bad_request("you can only create a project from your own idea"));
        }
    }
    tx.commit().await?;
    ok(pb::CreateProjectResponse { id: id.to_string() })
}

async fn request_to_join(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<StatusCode> {
    let project = parse_id(&id)?;
    let owner = visible_project(&state.db, user.id, project).await?;
    let is_participant: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM project_participants WHERE project_id = $1 AND user_id = $2)")
            .bind(project)
            .bind(user.id)
            .fetch_one(&state.db)
            .await?;
    if is_participant {
        return Err(AppError::conflict("already_participant", "you are already part of this project"));
    }
    let mut tx = state.db.begin().await?;
    let added = sqlx::query(
        "INSERT INTO project_participant_requests (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(project)
    .bind(user.id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if added > 0 {
        let target = NotificationTarget { project: Some(project), ..Default::default() };
        notify(&mut tx, owner, user.id, "join_request", target).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn cancel_join_request(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<StatusCode> {
    sqlx::query("DELETE FROM project_participant_requests WHERE project_id = $1 AND user_id = $2")
        .bind(parse_id(&id)?)
        .bind(user.id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn accept(decision: &str) -> AppResult<bool> {
    match decision {
        "accept" => Ok(true),
        "decline" => Ok(false),
        _ => Err(AppError::not_found()),
    }
}

async fn respond_to_join_request(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, requester, decision)): Path<(String, String, String)>,
) -> AppResult<StatusCode> {
    let project = parse_id(&id)?;
    let requester = parse_id(&requester)?;
    let accepted = accept(&decision)?;
    if visible_project(&state.db, user.id, project).await? != user.id {
        return Err(AppError::forbidden());
    }
    let mut tx = state.db.begin().await?;
    let removed = sqlx::query("DELETE FROM project_participant_requests WHERE project_id = $1 AND user_id = $2")
        .bind(project)
        .bind(requester)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if removed == 0 {
        return Err(AppError::not_found());
    }
    if accepted {
        sqlx::query("INSERT INTO project_participants (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(project)
            .bind(requester)
            .execute(&mut *tx)
            .await?;
        let target = NotificationTarget { project: Some(project), ..Default::default() };
        notify(&mut tx, requester, user.id, "request_accepted", target).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn respond_to_invite(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, decision)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let project = parse_id(&id)?;
    let accepted = accept(&decision)?;
    let mut tx = state.db.begin().await?;
    let removed = sqlx::query("DELETE FROM project_invites WHERE project_id = $1 AND user_id = $2")
        .bind(project)
        .bind(user.id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if removed == 0 {
        return Err(AppError::not_found());
    }
    if accepted {
        sqlx::query("INSERT INTO project_participants (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(project)
            .bind(user.id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `completed`: owner or participant (owners are participants too). Description, deadline and categories: owner only.
async fn update_task(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, task_id)): Path<(String, String)>,
    Proto(req): Proto<pb::UpdateTaskRequest>,
) -> AppResult<StatusCode> {
    let project = parse_id(&id)?;
    let task = parse_id(&task_id)?;
    let owner = visible_project(&state.db, user.id, project).await?;
    let edits_task = req.description.is_some() || req.deadline.is_some() || req.set_categories;
    if edits_task && owner != user.id {
        return Err(AppError::forbidden());
    }
    let member: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM project_participants WHERE project_id = $1 AND user_id = $2)")
            .bind(project)
            .bind(user.id)
            .fetch_one(&state.db)
            .await?;
    if !member {
        return Err(AppError::forbidden());
    }
    let description = req.description.as_deref().map(|d| text("description", d, 1, 1024)).transpose()?;
    let deadline = req.deadline.as_ref().map(from_ts).transpose()?;
    let categories = if req.set_categories { Some(parse_ids(&req.category_ids)?) } else { None };
    if categories.as_ref().is_some_and(|c| c.is_empty()) {
        return Err(AppError::bad_request("a task needs at least one category"));
    }

    let mut tx = state.db.begin().await?;
    let updated = sqlx::query(
        "UPDATE project_tasks
            SET completed = COALESCE($3, completed), description = COALESCE($4, description),
                deadline = COALESCE($5, deadline), updated_at = now()
          WHERE id = $1 AND project_id = $2",
    )
    .bind(task)
    .bind(project)
    .bind(req.completed)
    .bind(description)
    .bind(deadline)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::not_found());
    }
    if let Some(categories) = categories {
        sqlx::query("DELETE FROM project_task_categories WHERE project_id = $1 AND task_id = $2")
            .bind(project)
            .bind(task)
            .execute(&mut *tx)
            .await?;
        super::project_editor::insert_task_categories(&mut tx, project, task, &categories).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

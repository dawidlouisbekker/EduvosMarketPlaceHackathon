//! UserService (proto/incubator/v1/users.proto): profiles, prospects and skill vouches.

use std::collections::HashMap;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, put};
use axum::Router;
use time::OffsetDateTime;
use uuid::Uuid;

use super::proto::{ok, Proto, ProtoResult};
use super::views::{
    ideas_by_ids, notify, ordered, parse_id, problems_by_ids, projects_by_ids, summaries, summary, text, ts,
    NotificationTarget, IDEA_VISIBLE, PROJECT_VISIBLE,
};
use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::{pb, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/{id}", get(profile))
        .route("/users/{id}/problems", get(user_problems))
        .route("/users/{id}/ideas", get(user_ideas))
        .route("/users/{id}/projects", get(user_projects))
        .route("/users/{id}/skills/{skill}/vouch", put(vouch).delete(remove_vouch))
        .route("/me", patch(update_me))
        .route("/prospects", get(prospects))
        .route("/prospects/{user_id}", put(add_prospect).delete(remove_prospect))
}

// ---------------------------------------------------------------- profile

#[derive(sqlx::FromRow)]
struct VouchRow {
    skill: String,
    voucher_id: Uuid,
    project_id: Option<Uuid>,
    project_name: Option<String>,
    role_id: Option<Uuid>,
    role_name: Option<String>,
    created_at: OffsetDateTime,
}

#[derive(sqlx::FromRow)]
struct CountsRow {
    problems: i32,
    ideas: i32,
    projects: i32,
}

/// Roles `user` held in projects the viewer worked on (owner or participant), or all of them for an admin.
/// A skill vouch must name one of these.
async fn vouchable_roles(state: &AppState, viewer: &AuthUser, user: Uuid) -> AppResult<Vec<pb::VouchableRole>> {
    let rows: Vec<(Uuid, String, Uuid, String)> = sqlx::query_as(
        "SELECT a.project_id, p.name, a.role_id, r.name
           FROM project_participant_roles a
           JOIN projects p ON p.id = a.project_id
           JOIN project_roles r ON r.id = a.role_id
          WHERE a.user_id = $1
            AND ($3 OR p.owner_id = $2
                 OR EXISTS (SELECT 1 FROM project_participants x WHERE x.project_id = a.project_id AND x.user_id = $2))
          ORDER BY p.name, r.name",
    )
    .bind(user)
    .bind(viewer.id)
    .bind(viewer.is_admin)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(project_id, project_name, role_id, role_name)| pb::VouchableRole {
            project_id: project_id.to_string(),
            project_name,
            role_id: role_id.to_string(),
            role_name,
        })
        .collect())
}

async fn profile(State(state): State<AppState>, viewer: AuthUser, Path(id): Path<String>) -> ProtoResult<pb::GetProfileResponse> {
    let id = parse_id(&id)?;
    let db = &state.db;
    let user = summary(db, id).await?.ok_or_else(AppError::not_found)?;
    let is_self = id == viewer.id;

    let is_prospect: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM user_prospects WHERE owner_id = $1 AND prospect_id = $2)")
            .bind(viewer.id)
            .bind(id)
            .fetch_one(db)
            .await?;

    let claimed: Vec<String> = sqlx::query_scalar("SELECT skill FROM user_skills WHERE user_id = $1 ORDER BY created_at, skill")
        .bind(id)
        .fetch_all(db)
        .await?;
    let vouches = sqlx::query_as::<_, VouchRow>(
        "SELECT v.skill, v.voucher_id, v.project_id, p.name AS project_name, v.role_id, r.name AS role_name, v.created_at
           FROM skill_vouches v
           LEFT JOIN projects p ON p.id = v.project_id
           LEFT JOIN project_roles r ON r.id = v.role_id
          WHERE v.user_id = $1
          ORDER BY v.created_at DESC",
    )
    .bind(id)
    .fetch_all(db)
    .await?;
    let vouchers = summaries(db, vouches.iter().map(|v| v.voucher_id)).await?;
    let mut by_skill: HashMap<String, Vec<VouchRow>> = HashMap::new();
    for v in vouches {
        by_skill.entry(v.skill.clone()).or_default().push(v);
    }
    let mut skills: Vec<pb::UserSkill> = claimed
        .into_iter()
        .map(|skill| {
            let rows = by_skill.remove(&skill).unwrap_or_default();
            pb::UserSkill {
                vouch_count: rows.len() as i32,
                viewer_vouched: rows.iter().any(|v| v.voucher_id == viewer.id),
                vouches: rows
                    .into_iter()
                    .filter_map(|v| {
                        Some(pb::SkillVouch {
                            voucher: Some(vouchers.get(&v.voucher_id)?.clone()),
                            project: v.project_id.zip(v.project_name).map(|(id, name)| pb::ProjectRef { id: id.to_string(), name }),
                            role: v.role_id.zip(v.role_name).map(|(id, name)| pb::RoleRef { id: id.to_string(), name }),
                            created_at: Some(ts(v.created_at)),
                        })
                    })
                    .collect(),
                skill,
            }
        })
        .collect();
    skills.sort_by(|a, b| b.vouch_count.cmp(&a.vouch_count));

    let entrepreneur_vouches: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT v.project_id, p.name, v.description
           FROM user_entrepreneurial_vouches v JOIN projects p ON p.id = v.project_id
          WHERE v.user_id = $1 ORDER BY p.created_at",
    )
    .bind(id)
    .fetch_all(db)
    .await?;

    let counts = sqlx::query_as::<_, CountsRow>(sql!(
        "SELECT (SELECT count(*) FROM problems WHERE user_id = $2)::int4 AS problems,
                (SELECT count(*) FROM ideas i WHERE i.user_id = $2 AND {IDEA_VISIBLE})::int4 AS ideas,
                (SELECT count(*) FROM projects p WHERE {PROJECT_VISIBLE}
                    AND EXISTS (SELECT 1 FROM project_participants y WHERE y.project_id = p.id AND y.user_id = $2))::int4 AS projects"
    ))
    .bind(viewer.id)
    .bind(id)
    .fetch_one(db)
    .await?;

    ok(pb::GetProfileResponse {
        user: Some(user),
        is_self,
        is_prospect,
        skills,
        vouchable_roles: if is_self { Vec::new() } else { vouchable_roles(&state, &viewer, id).await? },
        entrepreneur_vouches: entrepreneur_vouches
            .into_iter()
            .map(|(project_id, project_name, description)| pb::EntrepreneurVouch {
                project_id: project_id.to_string(),
                project_name,
                description,
            })
            .collect(),
        counts: Some(pb::ProfileCounts { problems: counts.problems, ideas: counts.ideas, projects: counts.projects }),
    })
}

async fn user_problems(
    State(state): State<AppState>,
    viewer: AuthUser,
    Path(id): Path<String>,
) -> ProtoResult<pb::ListUserProblemsResponse> {
    let ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM problems WHERE user_id = $1 ORDER BY created_at DESC")
        .bind(parse_id(&id)?)
        .fetch_all(&state.db)
        .await?;
    ok(pb::ListUserProblemsResponse { problems: problems_by_ids(&state.db, viewer.id, &ids).await? })
}

async fn user_ideas(
    State(state): State<AppState>,
    viewer: AuthUser,
    Path(id): Path<String>,
) -> ProtoResult<pb::ListUserIdeasResponse> {
    let ids: Vec<Uuid> = sqlx::query_scalar(sql!(
        "SELECT i.id FROM ideas i WHERE i.user_id = $2 AND {IDEA_VISIBLE} ORDER BY i.created_at DESC"
    ))
    .bind(viewer.id)
    .bind(parse_id(&id)?)
    .fetch_all(&state.db)
    .await?;
    ok(pb::ListUserIdeasResponse { ideas: ideas_by_ids(&state.db, viewer.id, &ids).await? })
}

async fn user_projects(
    State(state): State<AppState>,
    viewer: AuthUser,
    Path(id): Path<String>,
) -> ProtoResult<pb::ListUserProjectsResponse> {
    let ids: Vec<Uuid> = sqlx::query_scalar(sql!(
        "SELECT p.id FROM projects p
          WHERE {PROJECT_VISIBLE}
            AND EXISTS (SELECT 1 FROM project_participants y WHERE y.project_id = p.id AND y.user_id = $2)
          ORDER BY p.created_at DESC"
    ))
    .bind(viewer.id)
    .bind(parse_id(&id)?)
    .fetch_all(&state.db)
    .await?;
    ok(pb::ListUserProjectsResponse { projects: projects_by_ids(&state.db, &ids).await? })
}

// ---------------------------------------------------------------- me

async fn update_me(State(state): State<AppState>, user: AuthUser, Proto(req): Proto<pb::UpdateMeRequest>) -> AppResult<StatusCode> {
    if let Some(bio) = req.bio {
        sqlx::query("UPDATE users SET bio = $2 WHERE id = $1")
            .bind(user.id)
            .bind(text("bio", &bio, 0, 256)?)
            .execute(&state.db)
            .await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------- prospects

async fn prospects(State(state): State<AppState>, user: AuthUser) -> ProtoResult<pb::ListProspectsResponse> {
    let ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT prospect_id FROM user_prospects WHERE owner_id = $1 ORDER BY created_at")
            .bind(user.id)
            .fetch_all(&state.db)
            .await?;
    ok(pb::ListProspectsResponse { prospects: ordered(&summaries(&state.db, ids.iter().copied()).await?, ids) })
}

async fn add_prospect(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<StatusCode> {
    let prospect = parse_id(&id)?;
    if prospect == user.id {
        return Err(AppError::bad_request("you cannot add yourself as a prospect"));
    }
    summary(&state.db, prospect).await?.ok_or_else(AppError::not_found)?;
    sqlx::query("INSERT INTO user_prospects (owner_id, prospect_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(user.id)
        .bind(prospect)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The idea_shares foreign key cascades, revoking their access to the viewer's private ideas.
async fn remove_prospect(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<StatusCode> {
    sqlx::query("DELETE FROM user_prospects WHERE owner_id = $1 AND prospect_id = $2")
        .bind(user.id)
        .bind(parse_id(&id)?)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------- vouches

async fn vouch(
    State(state): State<AppState>,
    viewer: AuthUser,
    Path((id, skill)): Path<(String, String)>,
    Proto(req): Proto<pb::VouchSkillRequest>,
) -> AppResult<StatusCode> {
    let user = parse_id(&id)?;
    let project = parse_id(&req.project_id)?;
    let role = parse_id(&req.role_id)?;
    if user == viewer.id {
        return Err(AppError::bad_request("you cannot vouch for yourself"));
    }
    let claims: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM user_skills WHERE user_id = $1 AND skill = $2)")
        .bind(user)
        .bind(&skill)
        .fetch_one(&state.db)
        .await?;
    if !claims {
        return Err(AppError::not_found());
    }
    let allowed = vouchable_roles(&state, &viewer, user)
        .await?
        .iter()
        .any(|r| r.project_id == project.to_string() && r.role_id == role.to_string());
    if !allowed {
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            "forbidden",
            "you can only vouch based on a role in a project you worked on",
        ));
    }

    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO skill_vouches (user_id, skill, voucher_id, project_id, role_id) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, skill, voucher_id) DO UPDATE SET project_id = EXCLUDED.project_id, role_id = EXCLUDED.role_id",
    )
    .bind(user)
    .bind(&skill)
    .bind(viewer.id)
    .bind(project)
    .bind(role)
    .execute(&mut *tx)
    .await?;
    notify(&mut tx, user, viewer.id, "skill_vouch", NotificationTarget::default()).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_vouch(
    State(state): State<AppState>,
    viewer: AuthUser,
    Path((id, skill)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    sqlx::query("DELETE FROM skill_vouches WHERE user_id = $1 AND skill = $2 AND voucher_id = $3")
        .bind(parse_id(&id)?)
        .bind(skill)
        .bind(viewer.id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

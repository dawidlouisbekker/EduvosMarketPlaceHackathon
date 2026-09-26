//! NotificationService (proto/incubator/v1/notifications.proto): the viewer's inbox.

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::Router;
use time::OffsetDateTime;
use uuid::Uuid;

use super::proto::{ok, ProtoResult};
use super::views::{summaries, ts};
use crate::auth::AuthUser;
use crate::error::AppResult;
use crate::{pb, AppState};

const INBOX_SIZE: i64 = 100;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/notifications", get(list))
        .route("/notifications/unread-count", get(unread_count))
        .route("/notifications/read-all", post(mark_all_read))
}

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    kind: String,
    actor_id: Option<Uuid>,
    problem_id: Option<Uuid>,
    problem_title: Option<String>,
    idea_id: Option<Uuid>,
    idea_title: Option<String>,
    project_id: Option<Uuid>,
    project_name: Option<String>,
    comment_id: Option<Uuid>,
    comment_excerpt: Option<String>,
    read_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
    actionable: bool,
}

fn kind(value: &str) -> pb::NotificationKind {
    use pb::NotificationKind as K;
    match value {
        "project_invite" => K::ProjectInvite,
        "join_request" => K::JoinRequest,
        "request_accepted" => K::RequestAccepted,
        "idea_comment" => K::IdeaComment,
        "comment_reply" => K::CommentReply,
        "skill_vouch" => K::SkillVouch,
        "idea_shared" => K::IdeaShared,
        "entrepreneur_vouch" => K::EntrepreneurVouch,
        _ => K::Unspecified,
    }
}

async fn list(State(state): State<AppState>, user: AuthUser) -> ProtoResult<pb::ListNotificationsResponse> {
    let rows = sqlx::query_as::<_, Row>(
        "SELECT n.id, n.kind::text AS kind, n.actor_id,
                n.problem_id, pb.title AS problem_title,
                n.idea_id, i.title AS idea_title,
                n.project_id, p.name AS project_name,
                n.comment_id, left(c.content, 80) AS comment_excerpt,
                n.read_at, n.created_at,
                CASE n.kind
                    WHEN 'project_invite' THEN EXISTS (SELECT 1 FROM project_invites x
                                                        WHERE x.project_id = n.project_id AND x.user_id = n.user_id)
                    WHEN 'join_request' THEN EXISTS (SELECT 1 FROM project_participant_requests x
                                                      WHERE x.project_id = n.project_id AND x.user_id = n.actor_id)
                    ELSE false
                END AS actionable
           FROM notifications n
           LEFT JOIN problems pb ON pb.id = n.problem_id
           LEFT JOIN ideas i ON i.id = n.idea_id
           LEFT JOIN projects p ON p.id = n.project_id
           LEFT JOIN idea_comments c ON c.id = n.comment_id
          WHERE n.user_id = $1
          ORDER BY n.created_at DESC
          LIMIT $2",
    )
    .bind(user.id)
    .bind(INBOX_SIZE)
    .fetch_all(&state.db)
    .await?;
    let actors = summaries(&state.db, rows.iter().filter_map(|r| r.actor_id)).await?;
    ok(pb::ListNotificationsResponse {
        notifications: rows
            .into_iter()
            .map(|r| pb::Notification {
                id: r.id.to_string(),
                kind: kind(&r.kind).into(),
                actor: r.actor_id.and_then(|a| actors.get(&a).cloned()),
                problem: r.problem_id.zip(r.problem_title).map(|(id, title)| pb::ProblemRef { id: id.to_string(), title }),
                idea: r.idea_id.zip(r.idea_title).map(|(id, title)| pb::IdeaRef { id: id.to_string(), title }),
                project: r.project_id.zip(r.project_name).map(|(id, name)| pb::ProjectRef { id: id.to_string(), name }),
                comment: r.comment_id.zip(r.comment_excerpt).map(|(id, excerpt)| pb::CommentRef { id: id.to_string(), excerpt }),
                read_at: r.read_at.map(ts),
                created_at: Some(ts(r.created_at)),
                actionable: r.actionable,
            })
            .collect(),
    })
}

async fn unread_count(State(state): State<AppState>, user: AuthUser) -> ProtoResult<pb::GetUnreadCountResponse> {
    let count: i32 = sqlx::query_scalar("SELECT count(*)::int4 FROM notifications WHERE user_id = $1 AND read_at IS NULL")
        .bind(user.id)
        .fetch_one(&state.db)
        .await?;
    ok(pb::GetUnreadCountResponse { count })
}

async fn mark_all_read(State(state): State<AppState>, user: AuthUser) -> AppResult<StatusCode> {
    sqlx::query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL")
        .bind(user.id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

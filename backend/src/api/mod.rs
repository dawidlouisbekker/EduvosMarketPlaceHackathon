//! The app's API. Bodies are protobuf; the contracts live in `proto/incubator/v1` and the HTTP conventions in
//! docs/adr/0001-protobuf-api-contracts.md. Every route requires a signed-in user.

/// `format!` for SQL. Only use it to splice in constant fragments (visibility predicates, a fixed ORDER BY);
/// values always go through `.bind()`.
macro_rules! sql {
    ($($arg:tt)*) => {
        sqlx::AssertSqlSafe(format!($($arg)*))
    };
}

mod ideas;
mod notifications;
mod problems;
mod project_editor;
mod projects;
pub mod proto;
mod users;
pub mod views;

use axum::Router;

use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(problems::router())
        .merge(ideas::router())
        .merge(projects::router())
        .merge(users::router())
        .merge(notifications::router())
}

mod auth;
mod config;
mod error;
mod models;
mod util;

use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{Value, json};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::auth::oidc::Oidc;
use crate::config::Config;
use crate::error::AppResult;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub cfg: Arc<Config>,
    pub http: reqwest::Client,
    pub oidc: Arc<Oidc>,
}

#[tokio::main]
async fn main() {
    // Load backend/.env for local runs. Variables already set in the environment (e.g. by
    // docker compose) take precedence, and a missing file is fine.
    let dotenv = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,backend=debug".into()))
        .init();
    match dotenv {
        Ok(path) => tracing::info!("loaded environment from {}", path.display()),
        Err(e) if e.not_found() => {}
        Err(e) => tracing::warn!("could not read .env: {e}"),
    }

    let cfg = Config::from_env().unwrap_or_else(|e| {
        eprintln!("configuration error: {e}");
        std::process::exit(1);
    });

    let db = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&cfg.database_url)
        .await
        .expect("failed to connect to Postgres");
    sqlx::migrate!().run(&db).await.expect("failed to run migrations");

    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .expect("failed to build HTTP client");

    let state = AppState {
        oidc: Arc::new(Oidc::new(&cfg, http.clone())),
        cfg: Arc::new(cfg),
        http,
        db,
    };

    let api = Router::new()
        .route("/health", get(health))
        .merge(auth::routes::router());

    let app = Router::new()
        .nest("/api", api)
        .layer(RequestBodyLimitLayer::new(64 * 1024))
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind(&state.cfg.bind).await.expect("failed to bind");
    tracing::info!("listening on {}", state.cfg.bind);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server error");
}

async fn health(State(state): State<AppState>) -> AppResult<Json<Value>> {
    sqlx::query("SELECT 1").execute(&state.db).await?;
    Ok(Json(json!({ "status": "ok" })))
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutting down");
}

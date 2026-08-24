mod api;
mod config;
mod db;
mod models;

use std::sync::Arc;

use axum::middleware;
use axum::routing::{get, patch, post};
use axum::Router;
use clap::Parser;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::api::AppState;

#[tokio::main]
async fn main() {
    let config = config::Config::parse();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,tower_http=info")),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let db = match db::Db::open(&config.db_path()) {
        Ok(db) => db,
        Err(err) => {
            tracing::error!(
                "无法打开数据库 {}: {err}",
                config.db_path().display()
            );
            std::process::exit(1);
        }
    };

    let token = config.resolve_token();
    tracing::info!("API token: {token}");
    let state = Arc::new(AppState {
        db,
        token: token.clone(),
    });

    let web_dir = config.web_dir();
    let index_file = web_dir.join("index.html");
    if !index_file.exists() {
        tracing::warn!(
            "管理界面未构建（预期位置 {}）；请在 server/web 下执行 `npm install && npm run build`。API 仍可正常使用。",
            index_file.display()
        );
    }

    // 鉴权层之前注册的路由需要 Bearer token；
    // /api/health 在鉴权层之后注册，保持公开。
    let api_routes = Router::new()
        .route("/bookmarks", get(api::list_bookmarks).post(api::create_bookmark))
        .route("/bookmarks/import", post(api::import_bookmarks))
        .route("/bookmarks/{id}", patch(api::update_bookmark).delete(api::delete_bookmark))
        .route("/bookmarks/{id}/restore", post(api::restore_bookmark))
        .route(
            "/folders",
            get(api::list_folders)
                .post(api::create_folder)
                .patch(api::rename_folder)
                .delete(api::delete_folder),
        )
        .route("/sync", post(api::sync))
        .layer(middleware::from_fn_with_state(state.clone(), api::require_auth))
        .route("/health", get(api::health))
        .with_state(state);

    let app = Router::new()
        .nest("/api", api_routes)
        .fallback_service(ServeDir::new(&web_dir).not_found_service(ServeFile::new(index_file)))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|err| {
            tracing::error!("无法监听 {addr}: {err}");
            std::process::exit(1);
        });

    tracing::info!(
        "markmax-server v{} 已启动，监听 http://{addr}",
        env!("CARGO_PKG_VERSION")
    );
    tracing::info!("管理界面: http://localhost:{}", config.port);

    axum::serve(listener, app).await.expect("服务器异常退出");
}

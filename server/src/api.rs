use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, Query, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use uuid::Uuid;

use crate::db::Db;
use crate::models::*;

pub struct AppState {
    pub db: Arc<Db>,
    pub token: String,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl ApiError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: msg.into(),
        }
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: msg.into(),
        }
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: msg.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(ErrorResponse { error: self.message })).into_response()
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(err: rusqlite::Error) -> Self {
        tracing::error!("数据库错误: {err}");
        ApiError::internal("数据库错误")
    }
}

type ApiResult<T> = Result<T, ApiError>;

/// API token 的常量时间比较，防时序攻击。
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub async fn require_auth(State(state): State<Arc<AppState>>, req: Request, next: Next) -> Response {
    let ok = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| constant_time_eq(t.as_bytes(), state.token.as_bytes()))
        .unwrap_or(false);
    if ok {
        next.run(req).await
    } else {
        (StatusCode::UNAUTHORIZED, Json(ErrorResponse { error: "未授权".to_string() })).into_response()
    }
}

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        time: now_ms(),
    })
}

pub async fn list_bookmarks(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<ListResponse>> {
    let limit = query.limit.unwrap_or(100).clamp(1, 5000);
    let offset = query.offset.unwrap_or(0).max(0);
    let deleted = query.deleted.unwrap_or(0) != 0;
    let (bookmarks, total) = state
        .db
        .list(query.q, query.folder, query.tag, deleted, limit, offset)
        .await?;
    Ok(Json(ListResponse { bookmarks, total }))
}

pub async fn create_bookmark(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateBookmark>,
) -> ApiResult<(StatusCode, Json<Bookmark>)> {    let url = body.url.trim().to_string();
    if url.is_empty() {
        return Err(ApiError::bad_request("网址不能为空"));
    }
    let now = now_ms();
    let bookmark = Bookmark {
        id: Uuid::new_v4().to_string(),
        title: body.title.trim().to_string(),
        url,
        tags: body.tags,
        notes: body.notes.trim().to_string(),
        folder: body.folder.trim().to_string(),
        created_at: now,
        updated_at: now,
        deleted: false,
        deleted_at: None,
    }
    .sanitize();
    state.db.insert(&bookmark).await?;
    Ok((StatusCode::CREATED, Json(bookmark)))
}

/// 批量导入：前端已解析为书签数组，服务端单事务插入，自动登记文件夹。
pub async fn import_bookmarks(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ImportRequest>,
) -> ApiResult<Json<ImportResponse>> {
    const MAX: usize = 10_000;
    if body.bookmarks.len() > MAX {
        return Err(ApiError::bad_request(format!("单次最多导入 {MAX} 条")));
    }
    let now = now_ms();
    let mut items = Vec::with_capacity(body.bookmarks.len());
    let mut skipped = 0usize;
    for b in body.bookmarks {
        let url = b.url.trim().to_string();
        if url.is_empty() {
            skipped += 1;
            continue;
        }
        items.push(
            Bookmark {
                id: Uuid::new_v4().to_string(),
                title: b.title.trim().to_string(),
                url,
                tags: b.tags,
                notes: b.notes.trim().to_string(),
                folder: b.folder.trim().to_string(),
                created_at: b.created_at.unwrap_or(now),
                updated_at: now,
                deleted: false,
                deleted_at: None,
            }
            .sanitize(),
        );
    }
    let created = state.db.insert_many(&items).await?;
    tracing::info!("导入: 新增 {created} 条，跳过 {skipped} 条");
    Ok(Json(ImportResponse { created, skipped }))
}

pub async fn update_bookmark(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateBookmark>,
) -> ApiResult<Json<Bookmark>> {
    if body.url.as_ref().is_some_and(|u| u.trim().is_empty()) {
        return Err(ApiError::bad_request("网址不能为空"));
    }
    let updated = state.db.update_fields(&id, &body, now_ms()).await?;
    updated
        .map(Json)
        .ok_or_else(|| ApiError::not_found(format!("书签 {id} 不存在")))
}

pub async fn delete_bookmark(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    state
        .db
        .soft_delete(&id, now_ms())
        .await?
        .ok_or_else(|| ApiError::not_found(format!("书签 {id} 不存在")))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn restore_bookmark(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult<Json<Bookmark>> {
    let restored = state.db.restore(&id, now_ms()).await?;
    restored
        .map(Json)
        .ok_or_else(|| ApiError::not_found(format!("书签 {id} 不存在")))
}

/// 单次往返同步：先应用客户端变更（最后写入者胜），
/// 再返回客户端缺失的记录（updated_at >= since，含软删除）。
pub async fn sync(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SyncRequest>,
) -> ApiResult<Json<SyncResponse>> {
    let mut applied = 0usize;
    for change in body.changes {
        if change.id.is_empty() {
            continue;
        }
        if !change.deleted && change.url.trim().is_empty() {
            continue;
        }
        state.db.apply_change(&change.sanitize()).await?;
        applied += 1;
    }
    if applied > 0 {
        tracing::info!("同步: 已应用 {applied} 条客户端变更");
    }
    let changes = state.db.changes_since(body.since, 100_000).await?;
    Ok(Json(SyncResponse {
        server_time: now_ms(),
        changes,
    }))
}

pub async fn list_folders(State(state): State<Arc<AppState>>) -> ApiResult<Json<FolderListResponse>> {
    let folders = state.db.list_folders().await?;
    Ok(Json(FolderListResponse { folders }))
}

pub async fn create_folder(
    State(state): State<Arc<AppState>>,
    Json(body): Json<FolderBody>,
) -> ApiResult<(StatusCode, Json<FolderInfo>)> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("文件夹名称不能为空"));
    }
    if !state.db.create_folder(&name, now_ms()).await? {
        return Err(ApiError::bad_request("文件夹已存在"));
    }
    Ok((StatusCode::CREATED, Json(FolderInfo { name, count: 0 })))
}

pub async fn rename_folder(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RenameFolderBody>,
) -> ApiResult<Json<FolderInfo>> {
    let old = body.name.trim().to_string();
    let new = body.new_name.trim().to_string();
    if old.is_empty() || new.is_empty() {
        return Err(ApiError::bad_request("文件夹名称不能为空"));
    }
    if old == new {
        return Err(ApiError::bad_request("新名称与旧名称相同"));
    }
    if state.db.folder_exists(&new).await? {
        return Err(ApiError::bad_request("目标文件夹已存在"));
    }
    if !state.db.rename_folder(&old, &new, now_ms()).await? {
        return Err(ApiError::not_found(format!("文件夹 {old} 不存在")));
    }
    Ok(Json(FolderInfo { name: new, count: 0 }))
}

pub async fn delete_folder(
    State(state): State<Arc<AppState>>,
    Json(body): Json<FolderBody>,
) -> ApiResult<StatusCode> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("文件夹名称不能为空"));
    }
    if !state.db.delete_folder(&name, now_ms()).await? {
        return Err(ApiError::not_found(format!("文件夹 {name} 不存在")));
    }
    Ok(StatusCode::NO_CONTENT)
}

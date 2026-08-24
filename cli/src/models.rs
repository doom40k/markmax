use serde::{Deserialize, Serialize};

/// 当前时间的 unix 毫秒。
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 书签模型：与服务端及 bookmarks.json 缓存格式完全一致（三端统一）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: String,
    #[serde(default)]
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub folder: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SyncRequest {
    pub since: i64,
    pub changes: Vec<Bookmark>,
}

#[derive(Debug, Deserialize)]
pub struct SyncResponse {
    pub server_time: i64,
    pub changes: Vec<Bookmark>,
}

#[derive(Debug, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    #[allow(dead_code)]
    pub time: i64,
}

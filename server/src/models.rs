use std::collections::HashSet;

use serde::{Deserialize, Serialize};

/// 书签模型：服务端存储格式，也是三端交换的统一格式。
/// 时间戳为 unix 毫秒。
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

impl Bookmark {
    /// 清理文本字段：去除首尾空白、去掉空标签并去重。
    pub fn sanitize(mut self) -> Self {
        self.title = self.title.trim().to_string();
        self.url = self.url.trim().to_string();
        self.folder = self.folder.trim().to_string();
        self.notes = self.notes.trim().to_string();
        let mut seen = HashSet::new();
        self.tags = self
            .tags
            .into_iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .filter(|t| seen.insert(t.clone()))
            .collect();
        self
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateBookmark {
    #[serde(default)]
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub folder: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct UpdateBookmark {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub folder: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    /// full-text-ish filter over title / url / notes / tags
    pub q: Option<String>,
    /// folder prefix match
    pub folder: Option<String>,
    /// exact tag match
    pub tag: Option<String>,
    /// 0 = live bookmarks (default), 1 = trash
    pub deleted: Option<i64>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ListResponse {
    pub bookmarks: Vec<Bookmark>,
    pub total: i64,
}

/// 文件夹信息：名字 + 精确匹配的书签数（不含子文件夹）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderInfo {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct FolderListResponse {
    pub folders: Vec<FolderInfo>,
}

#[derive(Debug, Deserialize)]
pub struct FolderBody {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct RenameFolderBody {
    pub name: String,
    pub new_name: String,
}

/// 导入单条书签（来自前端解析的 Chrome / Raindrop 书签 HTML）。
#[derive(Debug, Deserialize)]
pub struct ImportBookmark {
    #[serde(default)]
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub created_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub bookmarks: Vec<ImportBookmark>,
}

#[derive(Debug, Serialize)]
pub struct ImportResponse {
    pub created: usize,
    pub skipped: usize,
}

/// Body of POST /api/sync.
#[derive(Debug, Deserialize)]
pub struct SyncRequest {
    /// return every bookmark with updated_at >= since (0 = everything)
    #[serde(default)]
    pub since: i64,
    /// local changes to push; last-write-wins by updated_at
    #[serde(default)]
    pub changes: Vec<Bookmark>,
}

#[derive(Debug, Serialize)]
pub struct SyncResponse {
    pub server_time: i64,
    pub changes: Vec<Bookmark>,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
    pub time: i64,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

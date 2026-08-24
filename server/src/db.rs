use std::path::Path;
use std::sync::Arc;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use tokio::sync::Mutex;

use crate::models::{Bookmark, FolderInfo, UpdateBookmark};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS bookmarks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    url         TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '[]',
    notes       TEXT NOT NULL DEFAULT '',
    folder      TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0,
    deleted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_updated_at ON bookmarks(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_folder ON bookmarks(folder);
CREATE INDEX IF NOT EXISTS idx_bookmarks_deleted ON bookmarks(deleted);

CREATE TABLE IF NOT EXISTS folders (
    name       TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
);
";

const COLS: &str = "id, title, url, tags, notes, folder, created_at, updated_at, deleted, deleted_at";

pub struct Db {
    conn: Mutex<Connection>,
}

fn tags_to_json(tags: &[String]) -> String {
    serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string())
}

fn row_to_bookmark(row: &Row<'_>) -> rusqlite::Result<Bookmark> {
    let tags_json: String = row.get(3)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Bookmark {
        id: row.get(0)?,
        title: row.get(1)?,
        url: row.get(2)?,
        tags,
        notes: row.get(4)?,
        folder: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted: row.get::<_, i64>(8)? != 0,
        deleted_at: row.get(9)?,
    })
}

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Arc<Self>> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "busy_timeout", "5000")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Arc::new(Self {
            conn: Mutex::new(conn),
        }))
    }

    pub async fn insert(&self, b: &Bookmark) -> rusqlite::Result<()> {
        let conn = self.conn.lock().await;
        if !b.folder.is_empty() {
            conn.execute(
                "INSERT OR IGNORE INTO folders (name, created_at) VALUES (?1, ?2)",
                params![b.folder, b.created_at],
            )?;
        }
        conn.execute(
            "INSERT INTO bookmarks (id, title, url, tags, notes, folder, created_at, updated_at, deleted, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                b.id,
                b.title,
                b.url,
                tags_to_json(&b.tags),
                b.notes,
                b.folder,
                b.created_at,
                b.updated_at,
                b.deleted as i64,
                b.deleted_at
            ],
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn list(
        &self,
        q: Option<String>,
        folder: Option<String>,
        tag: Option<String>,
        deleted: bool,
        limit: i64,
        offset: i64,
    ) -> rusqlite::Result<(Vec<Bookmark>, i64)> {
        let mut conds: Vec<String> = Vec::new();
        let mut vals: Vec<Value> = Vec::new();

        if let Some(q) = q.filter(|s| !s.trim().is_empty()) {
            let like = format!("%{}%", q.trim());
            conds.push("(title LIKE ? OR url LIKE ? OR notes LIKE ? OR tags LIKE ?)".to_string());
            for _ in 0..4 {
                vals.push(like.clone().into());
            }
        }
        if let Some(folder) = folder.filter(|s| !s.trim().is_empty()) {
            conds.push("folder LIKE ?".to_string());
            vals.push(format!("{}%", folder.trim()).into());
        }
        if let Some(tag) = tag.filter(|s| !s.trim().is_empty()) {
            conds.push("tags LIKE ?".to_string());
            vals.push(format!("%\"{}\"%", tag.trim()).into());
        }
        conds.push(if deleted {
            "deleted = 1".to_string()
        } else {
            "deleted = 0".to_string()
        });
        let where_clause = format!("WHERE {}", conds.join(" AND "));

        let conn = self.conn.lock().await;
        let total: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM bookmarks {where_clause}"),
            params_from_iter(vals.iter()),
            |row| row.get(0),
        )?;

        let mut list_vals = vals.clone();
        list_vals.push(limit.into());
        list_vals.push(offset.into());
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLS} FROM bookmarks {where_clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?"
        ))?;
        let bookmarks = stmt
            .query_map(params_from_iter(list_vals.iter()), row_to_bookmark)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok((bookmarks, total))
    }

    /// 局部更新；刷新 updated_at。返回更新后的记录，id 不存在时返回 None。
    pub async fn update_fields(
        &self,
        id: &str,
        upd: &UpdateBookmark,
        now: i64,
    ) -> rusqlite::Result<Option<Bookmark>> {
        let mut sets: Vec<String> = Vec::new();
        let mut vals: Vec<Value> = Vec::new();
        if let Some(title) = &upd.title {
            sets.push("title = ?".to_string());
            vals.push(title.trim().to_string().into());
        }
        if let Some(url) = &upd.url {
            sets.push("url = ?".to_string());
            vals.push(url.trim().to_string().into());
        }
        if let Some(tags) = &upd.tags {
            sets.push("tags = ?".to_string());
            let tags: Vec<String> = tags
                .iter()
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect();
            vals.push(tags_to_json(&tags).into());
        }
        if let Some(notes) = &upd.notes {
            sets.push("notes = ?".to_string());
            vals.push(notes.trim().to_string().into());
        }
        if let Some(folder) = &upd.folder {
            sets.push("folder = ?".to_string());
            vals.push(folder.trim().to_string().into());
        }
        sets.push("updated_at = ?".to_string());
        vals.push(now.into());
        vals.push(id.to_string().into());

        let sql = format!("UPDATE bookmarks SET {} WHERE id = ? RETURNING {COLS}", sets.join(", "));
        let conn = self.conn.lock().await;
        conn.query_row(&sql, params_from_iter(vals.iter()), row_to_bookmark)
            .optional()
    }

    pub async fn soft_delete(&self, id: &str, now: i64) -> rusqlite::Result<Option<Bookmark>> {
        let conn = self.conn.lock().await;
        conn.query_row(
            &format!(
                "UPDATE bookmarks SET deleted = 1, deleted_at = ?1, updated_at = ?1 \
                 WHERE id = ?2 AND deleted = 0 RETURNING {COLS}"
            ),
            params![now, id],
            row_to_bookmark,
        )
        .optional()
    }

    pub async fn restore(&self, id: &str, now: i64) -> rusqlite::Result<Option<Bookmark>> {
        let conn = self.conn.lock().await;
        conn.query_row(
            &format!(
                "UPDATE bookmarks SET deleted = 0, deleted_at = NULL, updated_at = ?1 \
                 WHERE id = ?2 AND deleted = 1 RETURNING {COLS}"
            ),
            params![now, id],
            row_to_bookmark,
        )
        .optional()
    }

    /// 同步写入：插入；若传入记录更新则覆盖（最后写入者胜）。
    pub async fn apply_change(&self, b: &Bookmark) -> rusqlite::Result<()> {
        let conn = self.conn.lock().await;
        if !b.folder.is_empty() {
            conn.execute(
                "INSERT OR IGNORE INTO folders (name, created_at) VALUES (?1, ?2)",
                params![b.folder, b.created_at],
            )?;
        }
        conn.execute(
            "INSERT INTO bookmarks (id, title, url, tags, notes, folder, created_at, updated_at, deleted, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
                title      = excluded.title,
                url        = excluded.url,
                tags       = excluded.tags,
                notes      = excluded.notes,
                folder     = excluded.folder,
                updated_at = excluded.updated_at,
                deleted    = excluded.deleted,
                deleted_at = excluded.deleted_at
             WHERE excluded.updated_at > bookmarks.updated_at",
            params![
                b.id,
                b.title,
                b.url,
                tags_to_json(&b.tags),
                b.notes,
                b.folder,
                b.created_at,
                b.updated_at,
                b.deleted as i64,
                b.deleted_at
            ],
        )?;
        Ok(())
    }

    /// 返回 updated_at >= since 的全部记录（含软删除），按时间升序。
    pub async fn changes_since(&self, since: i64, limit: i64) -> rusqlite::Result<Vec<Bookmark>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLS} FROM bookmarks WHERE updated_at >= ?1 ORDER BY updated_at ASC LIMIT ?2"
        ))?;
        let rows = stmt.query_map(params![since, limit], row_to_bookmark)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    }

    /// 批量导入：单事务插入，自动登记文件夹。
    pub async fn insert_many(&self, items: &[Bookmark]) -> rusqlite::Result<usize> {
        let mut conn = self.conn.lock().await;
        let tx = conn.transaction()?;
        for b in items {
            if !b.folder.is_empty() {
                tx.execute(
                    "INSERT OR IGNORE INTO folders (name, created_at) VALUES (?1, ?2)",
                    params![b.folder, b.created_at],
                )?;
            }
            tx.execute(
                "INSERT INTO bookmarks (id, title, url, tags, notes, folder, created_at, updated_at, deleted, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    b.id,
                    b.title,
                    b.url,
                    tags_to_json(&b.tags),
                    b.notes,
                    b.folder,
                    b.created_at,
                    b.updated_at,
                    b.deleted as i64,
                    b.deleted_at
                ],
            )?;
        }
        tx.commit()?;
        Ok(items.len())
    }

    /// 全部文件夹（含空文件夹），附带精确匹配的书签数。
    /// 来源为 folders 表与书签数据中实际出现的 folder 的并集，保证与数据一致。
    pub async fn list_folders(&self) -> rusqlite::Result<Vec<FolderInfo>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT t.name, COUNT(b.id)
             FROM (
                 SELECT name FROM folders
                 UNION
                 SELECT DISTINCT folder FROM bookmarks WHERE folder != '' AND deleted = 0
             ) t
             LEFT JOIN bookmarks b ON b.folder = t.name AND b.deleted = 0
             GROUP BY t.name
             ORDER BY t.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(FolderInfo {
                name: row.get(0)?,
                count: row.get(1)?,
            })
        })?;
        rows.collect()
    }

    /// 创建文件夹；已存在时返回 false。
    pub async fn create_folder(&self, name: &str, now: i64) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().await;
        let affected = conn.execute(
            "INSERT OR IGNORE INTO folders (name, created_at) VALUES (?1, ?2)",
            params![name, now],
        )?;
        Ok(affected > 0)
    }

    /// 重命名文件夹（含其全部子文件夹），并前缀替换其下书签的 folder；不存在时返回 false。
    pub async fn rename_folder(&self, old: &str, new: &str, now: i64) -> rusqlite::Result<bool> {
        let mut conn = self.conn.lock().await;
        let tx = conn.transaction()?;
        // length() 按字符数计算，substr 同按字符，避免中文等多字节字符错位
        let affected = tx.execute(
            "UPDATE folders SET name = ?1 || substr(name, length(?2) + 1)
             WHERE name = ?2 OR name LIKE ?2 || '/%'",
            params![new, old],
        )?;
        if affected == 0 {
            return Ok(false);
        }
        tx.execute(
            "UPDATE bookmarks SET folder = ?1 || substr(folder, length(?2) + 1), updated_at = ?3
             WHERE folder = ?2 OR folder LIKE ?2 || '/%'",
            params![new, old, now],
        )?;
        tx.commit()?;
        Ok(true)
    }

    /// 检查文件夹是否已存在（含作为其它文件夹前缀的情况，用于重命名冲突预检）。
    pub async fn folder_exists(&self, name: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().await;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM folders WHERE name = ?1 OR name LIKE ?1 || '/%'",
            params![name],
            |row| row.get(0),
        )?;
        Ok(n > 0)
    }

    /// 删除文件夹，其下书签变为未分类；不存在时返回 false。
    pub async fn delete_folder(&self, name: &str, now: i64) -> rusqlite::Result<bool> {
        let mut conn = self.conn.lock().await;
        let tx = conn.transaction()?;
        let affected = tx.execute("DELETE FROM folders WHERE name = ?1", params![name])?;
        if affected == 0 {
            return Ok(false);
        }
        tx.execute(
            "UPDATE bookmarks SET folder = '', updated_at = ?2 WHERE folder = ?1",
            params![name, now],
        )?;
        tx.commit()?;
        Ok(true)
    }
}

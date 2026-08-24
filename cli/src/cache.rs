use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::config::{BOOKMARKS_FILE, FOLDERS_FILE};
use crate::models::Bookmark;

/// bookmarks.json 文件结构：与 Chrome 插件共享的缓存格式。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarksFile {
    pub version: u32,
    pub bookmarks: Vec<Bookmark>,
}

/// folders.json 结构：非空 folder 全集去重升序（Alfred mka 直接读取展示）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoldersFile {
    pub version: u32,
    pub folders: Vec<String>,
}

pub struct Cache {
    pub dir: PathBuf,
}

impl Cache {
    pub fn new(dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&dir).context("创建缓存目录失败")?;
        Ok(Self { dir })
    }

    pub fn bookmarks_path(&self) -> PathBuf {
        self.dir.join(BOOKMARKS_FILE)
    }

    pub fn folders_path(&self) -> PathBuf {
        self.dir.join(FOLDERS_FILE)
    }

    /// 从书签列表提取文件夹全集：未删除且 folder 非空，去重升序。
    pub fn collect_folders(bookmarks: &[Bookmark]) -> Vec<String> {
        let mut set: BTreeSet<String> = BTreeSet::new();
        for b in bookmarks {
            if !b.deleted && !b.folder.is_empty() {
                set.insert(b.folder.clone());
            }
        }
        set.into_iter().collect()
    }

    /// 读取文件夹列表；文件缺失或损坏返回空列表（派生数据可随时重建）。
    /// 供调试与测试使用；Alfred mka.sh 直接读文件，不经此方法。
    #[allow(dead_code)]
    pub fn read_folders(&self) -> Result<Vec<String>> {
        let path = self.folders_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let raw = std::fs::read_to_string(&path).context("读取文件夹列表失败")?;
        let file: FoldersFile = serde_json::from_str(&raw).context("解析文件夹列表失败")?;
        Ok(file.folders)
    }

    /// 原子写文件夹列表：临时文件 + rename，与书签缓存写入方式一致。
    pub fn write_folders(&self, folders: &[String]) -> Result<()> {
        let file = FoldersFile {
            version: 1,
            folders: folders.to_vec(),
        };
        let raw = serde_json::to_string_pretty(&file).context("序列化文件夹列表失败")?;
        let tmp = self.dir.join(format!(".{FOLDERS_FILE}.tmp"));
        std::fs::write(&tmp, raw).context("写入文件夹列表失败")?;
        std::fs::rename(&tmp, self.folders_path()).context("替换文件夹列表失败")?;
        Ok(())
    }

    /// 读取书签；文件不存在返回 None。
    pub fn read_bookmarks(&self) -> Result<Option<Vec<Bookmark>>> {
        let path = self.bookmarks_path();
        if !path.exists() {
            return Ok(None);
        }
        let raw = std::fs::read_to_string(&path).context("读取书签缓存失败")?;
        let file: BookmarksFile = serde_json::from_str(&raw).context("解析书签缓存失败")?;
        Ok(Some(file.bookmarks))
    }

    /// bookmarks.json 的修改时间（毫秒）；文件不存在返回 0。
    pub fn bookmarks_mtime(&self) -> Result<i64> {
        let path = self.bookmarks_path();
        match std::fs::metadata(&path) {
            Ok(meta) => meta
                .modified()
                .map(|t| {
                    t.duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0)
                })
                .context("读取书签缓存修改时间失败"),
            Err(_) => Ok(0),
        }
    }

    /// 原子写：临时文件 + rename，避免对端（插件）读到半截文件。
    pub fn write_bookmarks(&self, bookmarks: &[Bookmark]) -> Result<()> {
        let file = BookmarksFile {
            version: 1,
            bookmarks: bookmarks.to_vec(),
        };
        let raw = serde_json::to_string_pretty(&file).context("序列化书签缓存失败")?;
        let tmp = self.dir.join(format!(".{BOOKMARKS_FILE}.tmp"));
        std::fs::write(&tmp, raw).context("写入书签缓存失败")?;
        std::fs::rename(&tmp, self.bookmarks_path()).context("替换书签缓存失败")?;
        // 静默维护派生数据：每次书签写入都同步刷新 folders.json，供 Alfred mka 直接消费。
        self.write_folders(&Self::collect_folders(bookmarks))?;
        Ok(())
    }

    /// 按 id 合并服务端变更（last-write-wins），返回本地是否有变化。
    pub fn merge_changes(local: &mut Vec<Bookmark>, changes: &[Bookmark]) -> bool {
        let mut changed = false;
        let mut map: HashMap<String, Bookmark> = local.iter().map(|b| (b.id.clone(), b.clone())).collect();
        for c in changes {
            match map.get(&c.id) {
                None => {
                    map.insert(c.id.clone(), c.clone());
                    changed = true;
                }
                Some(local_b) if local_b.updated_at < c.updated_at => {
                    map.insert(c.id.clone(), c.clone());
                    changed = true;
                }
                _ => {}
            }
        }
        if changed {
            *local = map.into_values().collect();
        }
        changed
    }

    /// 清理已确认同步到服务端的删除记录（tombstone），返回是否有变化。
    pub fn prune_deleted(local: &mut Vec<Bookmark>, last_sync: i64) -> bool {
        let before = local.len();
        local.retain(|b| !(b.deleted && b.updated_at <= last_sync));
        local.len() != before
    }
}

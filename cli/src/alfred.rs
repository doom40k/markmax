/*!
 * markmax Alfred workflow 支持：
 * - `search`：从本机缓存搜索书签（可输出 Alfred Script Filter JSON）
 * - `add` / `remove`：快速添加 / 软删除缓存书签
 * - `install-alfred`：把 workflow 安装到 Alfred 配置目录（模板见项目 alfred/template/）
 */

use std::path::PathBuf;
use std::{collections::BTreeSet, collections::HashMap};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::cache::Cache;
use crate::config;
use crate::models::{now_ms, Bookmark};

fn host_of(url: &str) -> String {
    url.trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or(url)
        .to_string()
}

fn time_ago(ts: i64) -> String {
    let s = ((now_ms() - ts).max(0) / 1000) as u64;
    if s < 60 {
        return format!("{s}s");
    }
    let m = s / 60;
    if m < 60 {
        return format!("{m}m");
    }
    let h = m / 60;
    if h < 24 {
        return format!("{h}h");
    }
    format!("{}d", h / 24)
}

/// 关键词拆分：小写化后按空白拆分（多词 AND 匹配）。
fn words_of(s: &str) -> Vec<String> {
    s.to_lowercase().split_whitespace().map(String::from).collect()
}

/// 书签是否命中全部关键词（title/url/notes/folder/tags）。
fn matches_words(b: &Bookmark, words: &[String]) -> bool {
    if words.is_empty() {
        return true;
    }
    let hay = format!("{} {} {} {} {}", b.title, b.url, b.notes, b.folder, b.tags.join(" ")).to_lowercase();
    words.iter().all(|w| hay.contains(w))
}

/// Alfred JSON 单条书签条目：回车打开，⌘↩ 复制链接。
fn bookmark_item(b: &Bookmark) -> Value {
    let title = if b.title.is_empty() { host_of(&b.url) } else { b.title.clone() };
    let mut sub = host_of(&b.url);
    if !b.folder.is_empty() {
        sub.push_str(&format!(" · {}", b.folder));
    }
    if !b.tags.is_empty() {
        sub.push_str(&format!(
            " · {}",
            b.tags.iter().map(|t| format!("#{t}")).collect::<Vec<_>>().join(" ")
        ));
    }
    sub.push_str(&format!(" · {}", time_ago(b.updated_at)));
    json!({
        "uid": b.id,
        "title": title,
        "subtitle": sub,
        "arg": format!("open\u{1f}{}", b.url),
        "mods": {
            "cmd": {
                "arg": format!("copy\u{1f}{}", b.url),
                "subtitle": "⌘↩ 复制链接",
            },
        },
    })
}

/// Alfred JSON 单条文件夹条目：⇥ 补全进入浏览，不产生动作。
fn folder_item(name: &str, count: usize, autocomplete: String) -> Value {
    json!({
        "title": name,
        "subtitle": format!("{count} 条书签 · ⇥ 进入"),
        "autocomplete": autocomplete,
        "valid": false,
    })
}

/// 搜索结果按 updated_at 倒序截断并转为 Alfred 条目。
fn hits_to_items(mut hits: Vec<&Bookmark>, limit: usize) -> Vec<Value> {
    hits.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    hits.truncate(limit);
    hits.into_iter().map(bookmark_item).collect()
}

/// mk 视图分派：根视图 / 未分类浏览 / 文件夹浏览 / 全局搜索。
enum View {
    /// 空查询：顶层文件夹段 + 未分类。
    Root,
    /// `~` 哨兵：folder 为空的书签（未分类），可带过滤词。
    Uncat(Vec<String>),
    /// `前缀/` 或 `前缀/过滤词`：列出子文件夹段 + 前缀内书签。
    Browse(String, Vec<String>),
    /// 其它普通关键词：全局搜索。
    Global(Vec<String>),
}

fn resolve_view(q: &str) -> View {
    if q.is_empty() {
        return View::Root;
    }
    if q == "~" || q.starts_with("~/") {
        return View::Uncat(words_of(q.trim_start_matches('~').trim_start_matches('/')));
    }
    if let Some(pos) = q.rfind('/') {
        return View::Browse(q[..pos].to_string(), words_of(&q[pos + 1..]));
    }
    View::Global(words_of(q))
}

/// 搜索本机缓存书签。多关键词为 AND 匹配（title/url/notes/folder/tags）。
/// --alfred 输出 Script Filter JSON 并支持文件夹浏览查询语法（见 design.md）。
pub fn cmd_search(query: Option<String>, alfred: bool, limit: usize) -> Result<()> {
    let cfg = config::load()?.context("尚未配置，请先运行 markmax-sync --config")?;
    let cache = Cache::new(cfg.cache_dir.clone())?;
    let bookmarks = cache.read_bookmarks()?.unwrap_or_default();

    // 无 --alfred 时保持原有 TSV 输出不变。
    if !alfred {
        let words = words_of(query.as_deref().unwrap_or_default());
        let mut items: Vec<Bookmark> = bookmarks
            .into_iter()
            .filter(|b| !b.deleted && matches_words(b, &words))
            .collect();
        items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        items.truncate(limit);
        for b in &items {
            println!("{}\t{}\t{}", b.id, b.title, b.url);
        }
        return Ok(());
    }

    let mut items: Vec<Value> = Vec::new();
    let live: Vec<Bookmark> = bookmarks.into_iter().filter(|b| !b.deleted).collect();

    match resolve_view(query.as_deref().unwrap_or_default().trim()) {
        View::Global(words) => {
            items = hits_to_items(live.iter().filter(|b| matches_words(b, &words)).collect(), limit);
        }
        View::Root => {
            // 顶层段计数：segment → 该前缀下（含子文件夹）的书签数；另计未分类。
            let mut seg_count: HashMap<String, usize> = HashMap::new();
            let mut uncat = 0usize;
            for b in &live {
                if b.folder.is_empty() {
                    uncat += 1;
                    continue;
                }
                let seg = b.folder.split('/').next().unwrap_or_default().to_string();
                *seg_count.entry(seg).or_insert(0) += 1;
            }
            if uncat > 0 {
                items.push(folder_item("未分类", uncat, "~/".to_string()));
            }
            items.extend(
                seg_count
                    .into_iter()
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .map(|(seg, count)| folder_item(&seg, count, format!("{seg}/"))),
            );
        }
        View::Uncat(words) => {
            items = hits_to_items(
                live.iter().filter(|b| b.folder.is_empty() && matches_words(b, &words)).collect(),
                limit,
            );
        }
        View::Browse(prefix, words) => {
            // 子文件夹段：prefix 的直接下级 segment（按过滤词过滤）。
            let child_tag = format!("{prefix}/");
            let mut segs: BTreeSet<String> = BTreeSet::new();
            for b in &live {
                if let Some(rest) = b.folder.strip_prefix(&child_tag) {
                    let seg = rest.split('/').next().unwrap_or_default();
                    if !seg.is_empty() {
                        segs.insert(seg.to_string());
                    }
                }
            }
            for seg in segs {
                if !words.iter().all(|w| seg.to_lowercase().contains(w)) {
                    continue;
                }
                let full = format!("{child_tag}{seg}");
                let count = live
                    .iter()
                    .filter(|b| b.folder == full || b.folder.starts_with(&format!("{full}/")))
                    .count();
                items.push(folder_item(&seg, count, format!("{full}/")));
            }
            // 前缀内书签（含子文件夹）。
            items.extend(hits_to_items(
                live.iter()
                    .filter(|b| (b.folder == prefix || b.folder.starts_with(&child_tag)) && matches_words(b, &words))
                    .collect(),
                limit,
            ));
        }
    }
    if items.is_empty() {
        items.push(json!({ "title": "无匹配结果", "valid": false }));
    }
    println!("{}", serde_json::to_string(&json!({ "items": items }))?);
    Ok(())
}

/// 快速添加书签到本机缓存；CLI daemon 会自动同步到服务端。
pub fn cmd_add(
    url: String,
    title: Option<String>,
    folder: Option<String>,
    tags: Option<String>,
    notify: bool,
) -> Result<()> {
    let cfg = config::load()?.context("尚未配置，请先运行 markmax-sync --config")?;
    let cache = Cache::new(cfg.cache_dir.clone())?;
    let mut list = cache.read_bookmarks()?.unwrap_or_default();
    let now = now_ms();
    let tags = tags
        .map(|t| {
            t.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let bookmark = Bookmark {
        id: Uuid::new_v4().to_string(),
        title: title.unwrap_or_default().trim().to_string(),
        url: url.trim().to_string(),
        tags,
        notes: String::new(),
        folder: folder.unwrap_or_default().trim().to_string(),
        created_at: now,
        updated_at: now,
        deleted: false,
        deleted_at: None,
    };
    list.insert(0, bookmark.clone());
    cache.write_bookmarks(&list)?;
    if notify {
        let msg = format!(
            "display notification \"已添加：{}\" with title \"markmax\"",
            escape_applescript(&bookmark.title)
        );
        let _ = std::process::Command::new("osascript").arg("-e").arg(msg).output();
    }
    println!("已添加: {}", bookmark.title);
    Ok(())
}

/// 将缓存中的书签移入回收站（软删除）；CLI daemon 同步后传播到服务端。
pub fn cmd_remove(id: String, notify: bool) -> Result<()> {
    let cfg = config::load()?.context("尚未配置，请先运行 markmax-sync --config")?;
    let cache = Cache::new(cfg.cache_dir.clone())?;
    let mut list = cache.read_bookmarks()?.unwrap_or_default();
    let Some(b) = list.iter_mut().find(|b| b.id == id) else {
        bail!("未找到书签 {id}");
    };
    let now = now_ms();
    b.deleted = true;
    b.deleted_at = Some(now);
    b.updated_at = now;
    let title = b.title.clone();
    cache.write_bookmarks(&list)?;
    if notify {
        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg("display notification \"已移入回收站\" with title \"markmax\"")
            .output();
    }
    println!("已移入回收站: {title}");
    Ok(())
}

fn escape_applescript(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

const WORKFLOW_DIR_NAME: &str = "user.workflow.markmax-sync";

/// 把 Alfred workflow 安装到 Alfred 配置目录。
/// 模板位于项目 alfred/template/，安装时将 {CLI_PATH} 替换为本二进制的绝对路径。
pub fn install_alfred() -> Result<()> {
    let exe = std::env::current_exe().context("获取可执行文件路径失败")?;
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let base = PathBuf::from(home)
        .join("Library/Application Support/Alfred/Alfred.alfredpreferences/workflows");
    if !base.exists() {
        bail!(
            "未找到 Alfred 配置目录（{}）。请确认已安装 Alfred 5，或手动将 alfred/ 目录导入。",
            base.display()
        );
    }

    // 模板源码目录（与 cli/ 平级的 alfred/template）
    let tmpl_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../alfred/template");
    let wf = base.join(WORKFLOW_DIR_NAME);
    std::fs::create_dir_all(wf.join("scripts")).context("创建 workflow 目录失败")?;

    // info.plist（不含 CLI 路径，无需替换）
    let plist =
        std::fs::read_to_string(tmpl_dir.join("info.plist")).context("读取 info.plist 模板失败")?;
    std::fs::write(wf.join("info.plist"), plist).context("写入 info.plist 失败")?;

    // 脚本：注入 CLI 绝对路径
    for name in ["mk.sh", "mka.sh", "action.sh"] {
        let content = std::fs::read_to_string(tmpl_dir.join(name))
            .with_context(|| format!("读取 {name} 模板失败"))?
            .replace("{CLI_PATH}", &exe.display().to_string());
        let target = wf.join("scripts").join(name);
        std::fs::write(&target, content)
            .with_context(|| format!("写入 {} 失败", target.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                &target,
                std::fs::Permissions::from_mode(0o755),
            )
            .with_context(|| format!("设置 {} 权限失败", target.display()))?;
        }
    }

    // 图标（复用插件图标）
    let icon_src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../extension/icons/icon128.png");
    if icon_src.exists() {
        let _ = std::fs::copy(&icon_src, wf.join("icon.png"));
    }

    tracing::info!("Alfred workflow 已安装到 {}", wf.display());
    tracing::info!("keywords: mk（搜索）、mka（添加当前标签页）");
    tracing::info!("如未立即生效，请在 Alfred 设置中 Reload Workflows 或重启 Alfred");
    tracing::info!("首次使用各浏览器时，macOS 会请求自动化授权，请允许");
    Ok(())
}

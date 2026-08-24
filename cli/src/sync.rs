use std::path::Path;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use reqwest::header::AUTHORIZATION;
use tokio::sync::mpsc;

use crate::cache::Cache;
use crate::config::{self, Config, SyncConfig};
use crate::models::{Bookmark, HealthResponse, SyncRequest, SyncResponse};

#[derive(Debug, Clone, Copy)]
pub struct SyncStats {
    pub pushed: usize,
    pub received: usize,
}

pub struct Syncer {
    http: reqwest::Client,
    config: SyncConfig,
}

impl Syncer {
    pub fn new(config: &SyncConfig) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(format!("markmax-sync/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .context("初始化 HTTP 客户端失败")?;
        Ok(Self {
            http,
            config: config.clone(),
        })
    }

    pub async fn health(&self) -> Result<HealthResponse> {
        let resp = self
            .http
            .get(format!("{}/api/health", self.config.server))
            .send()
            .await
            .context("请求失败")?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            bail!("服务端返回 HTTP {status}: {body}");
        }
        serde_json::from_str(&body).context("解析健康检查响应失败")
    }

    /// 单次双向同步：推送本地变更，拉取服务端变更并合并写回缓存。
    pub async fn sync_once(&self, cache: &Cache) -> Result<SyncStats> {
        let mut cfg = config::load()?.context("未找到配置，请先运行交互式配置")?;
        let local = cache.read_bookmarks()?.unwrap_or_default();
        let changes: Vec<Bookmark> = local
            .iter()
            .filter(|b| b.updated_at > cfg.last_sync)
            .cloned()
            .collect();

        let resp = self.exchange(cfg.last_sync, &changes).await?;

        let mut merged = local;
        if Cache::merge_changes(&mut merged, &resp.changes) {
            merged.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            cache.write_bookmarks(&merged)?;
        }
        if Cache::prune_deleted(&mut merged, resp.server_time) {
            cache.write_bookmarks(&merged)?;
        }

        let stats = SyncStats {
            pushed: changes.len(),
            received: resp.changes.len(),
        };
        cfg.last_sync = resp.server_time;
        config::save(&cfg)?;
        Ok(stats)
    }

    async fn exchange(&self, since: i64, changes: &[Bookmark]) -> Result<SyncResponse> {
        let resp = self
            .http
            .post(format!("{}/api/sync", self.config.server))
            .header(AUTHORIZATION, format!("Bearer {}", self.config.token))
            .json(&SyncRequest { since, changes: changes.to_vec() })
            .send()
            .await
            .context("请求失败")?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            bail!("同步失败（HTTP {status}）: {body}");
        }
        serde_json::from_str(&body).context("解析同步响应失败")
    }
}

/// 后台服务：启动立即同步一次，之后文件变更即时同步 + 定时兜底同步。
pub async fn run_daemon(config: Config, interval_secs: u64, cache: Cache) -> Result<()> {
    let syncer = Syncer::new(&config.sync)?;

    match syncer.sync_once(&cache).await {
        Ok(st) => tracing::info!("初始同步完成: 推送 {} 条，接收 {} 条", st.pushed, st.received),
        Err(err) => tracing::warn!("初始同步失败（稍后自动重试）: {err:#}"),
    }

    let (tx, mut rx) = mpsc::channel::<notify::Result<Event>>(64);
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let _ = tx.blocking_send(res);
    })
    .context("初始化文件监听失败")?;
    watcher
        .watch(&cache.dir, RecursiveMode::NonRecursive)
        .context("监听缓存目录失败")?;
    tracing::info!("正在监听缓存目录: {}", cache.dir.display());

    let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
    let bookmarks_path = cache.bookmarks_path();
    let mut ignore_until = None::<std::time::Instant>;

    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                tracing::info!("收到退出信号，正在停止…");
                break;
            }
            ev = rx.recv() => {
                let Some(Ok(event)) = ev else { continue };
                if !is_bookmarks_event(&event, &bookmarks_path) { continue; }
                if ignore_until.is_some_and(|t| std::time::Instant::now() < t) { continue; }
                // debounce：等插件写完整个文件再同步
                tokio::time::sleep(Duration::from_millis(400)).await;
                match syncer.sync_once(&cache).await {
                    Ok(st) => tracing::info!("文件变更同步: 推送 {} 条，接收 {} 条", st.pushed, st.received),
                    Err(err) => tracing::warn!("同步失败（稍后自动重试）: {err:#}"),
                }
                // 本工具写回文件会再次触发事件，短暂忽略避免循环
                ignore_until = Some(std::time::Instant::now() + Duration::from_secs(2));
            }
            _ = ticker.tick() => {
                match syncer.sync_once(&cache).await {
                    Ok(st) => tracing::info!("定时同步: 推送 {} 条，接收 {} 条", st.pushed, st.received),
                    Err(err) => tracing::warn!("同步失败（稍后自动重试）: {err:#}"),
                }
            }
        }
    }
    Ok(())
}

fn is_bookmarks_event(event: &Event, bookmarks_path: &Path) -> bool {
    // 用文件名匹配：macOS 上 FSEvents 返回规范化路径（如 /private/tmp 而非 /tmp 符号链接）
    let target = bookmarks_path.file_name();
    event.paths.iter().any(|p| p.file_name() == target)
        && matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Any
        )
}

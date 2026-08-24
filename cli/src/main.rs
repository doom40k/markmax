mod alfred;
mod cache;
mod config;
mod host;
mod models;
mod sync;

use std::io::IsTerminal;
use std::path::PathBuf;

use anyhow::{bail, Result};
use clap::Parser;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::cache::Cache;
use crate::config::Config;

#[derive(Parser, Debug)]
#[command(
    name = "markmax-sync",
    version,
    about = "markmax 书签本地同步工具（后台运行，与 Chrome 插件共享缓存目录）"
)]
struct Cli {
    /// 缓存目录（与 Chrome 插件使用同一目录）
    #[arg(long)]
    cache_dir: Option<PathBuf>,

    /// 服务端地址
    #[arg(long)]
    server: Option<String>,

    /// API token
    #[arg(long)]
    token: Option<String>,

    /// 立即同步一次后退出
    #[arg(long)]
    sync: bool,

    /// 重新交互式配置
    #[arg(long)]
    config: bool,

    /// 定时同步间隔（秒，默认 3 分钟）
    #[arg(long, default_value_t = 180)]
    interval: u64,

    /// 以 Native Messaging 宿主模式运行（供 Chrome 插件调用，勿手动使用）
    #[arg(long, hide = true)]
    native_host: bool,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(clap::Subcommand, Debug)]
enum Commands {
    /// 注册 Chrome / Chromium / Brave / Edge 的 Native Messaging 宿主清单
    InstallHost,
    /// 安装 Alfred workflow（mk 搜索 / mka 添加）
    InstallAlfred,
    /// 搜索本机缓存中的书签
    Search {
        /// 搜索关键词（多词 AND 匹配，空 = 列最近）
        query: Option<String>,
        /// 输出 Alfred Script Filter JSON
        #[arg(long)]
        alfred: bool,
        /// 返回条数上限
        #[arg(long, default_value_t = 30)]
        limit: usize,
    },
    /// 快速添加书签到本机缓存
    Add {
        /// 书签网址
        #[arg(long)]
        url: String,
        /// 书签标题（可省略）
        #[arg(long)]
        title: Option<String>,
        /// 文件夹路径
        #[arg(long)]
        folder: Option<String>,
        /// 标签（逗号分隔）
        #[arg(long)]
        tags: Option<String>,
        /// 完成后发送 macOS 通知
        #[arg(long)]
        notify: bool,
    },
    /// 将书签移入回收站（软删除，同步后传播到服务端）
    Remove {
        id: String,
        #[arg(long)]
        notify: bool,
    },
}

/// 后台服务环境（brew services / launchd）无 TTY：禁止进入交互式配置，避免服务反复失败。
fn require_tty() -> Result<()> {
    if std::io::stdin().is_terminal() {
        return Ok(());
    }
    bail!("当前无交互终端：请先在终端运行 markmax-sync --config 完成首次配置");
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cli = Cli::parse();

    // 子命令处理（不依赖交互式配置流程）
    if let Some(command) = &cli.command {
        match command {
            Commands::InstallHost => {
                host::install_host_manifest()?;
                return Ok(());
            }
            Commands::InstallAlfred => {
                alfred::install_alfred()?;
                return Ok(());
            }
            Commands::Search { query, alfred, limit } => {
                alfred::cmd_search(query.clone(), *alfred, *limit)?;
                return Ok(());
            }
            Commands::Add { url, title, folder, tags, notify } => {
                alfred::cmd_add(url.clone(), title.clone(), folder.clone(), tags.clone(), *notify)?;
                return Ok(());
            }
            Commands::Remove { id, notify } => {
                alfred::cmd_remove(id.clone(), *notify)?;
                return Ok(());
            }
        }
    }

    // Native Messaging 宿主模式（由 Chrome 启动，无参数）
    if cli.native_host {
        return host::run_native_host();
    }

    // 重新配置：交互式流程后退出
    if cli.config {
        require_tty()?;
        let cfg = config::interactive(None)?;
        tracing::info!("配置完成: 缓存目录 {}", cfg.cache_dir.display());
        return Ok(());
    }

    // 未配置时进入交互式配置流程（后台服务环境无 TTY，禁止进入交互）
    let mut sync_cfg = match config::load()? {
        Some(cfg) => cfg,
        None => {
            require_tty()?;
            tracing::warn!("首次运行：请完成以下配置");
            config::interactive(None)?.sync
        }
    };

    // 命令行参数覆盖配置
    if let Some(cache_dir) = cli.cache_dir {
        sync_cfg.cache_dir = cache_dir;
    }
    if let Some(server) = cli.server {
        sync_cfg.server = server.trim().trim_end_matches('/').to_string();
    }
    if let Some(token) = cli.token {
        sync_cfg.token = token.trim().to_string();
    }
    if sync_cfg.server.is_empty() || sync_cfg.token.is_empty() {
        require_tty()?;
        tracing::warn!("配置不完整，进入交互式配置…");
        sync_cfg = config::interactive(Some(sync_cfg.cache_dir.clone()))?.sync;
    } else {
        config::save(&sync_cfg)?;
    }

    let cache_dir = sync_cfg.cache_dir.clone();
    let config = Config {
        cache_dir: cache_dir.clone(),
        sync: sync_cfg,
    };
    let cache = Cache::new(cache_dir)?;

    // 验证服务端连接
    let syncer = sync::Syncer::new(&config.sync)?;
    match syncer.health().await {
        Ok(health) => tracing::info!(
            "已连接服务端 {}（v{}，状态 {}）",
            config.sync.server,
            health.version,
            health.status
        ),
        Err(err) => tracing::warn!("无法连接服务端 {}：{err:#}", config.sync.server),
    }

    // 单次同步模式
    if cli.sync {
        let stats = syncer.sync_once(&cache).await?;
        tracing::info!("同步完成: 推送 {} 条，接收 {} 条", stats.pushed, stats.received);
        return Ok(());
    }

    tracing::info!(
        "markmax-sync v{} 作为后台服务运行（Ctrl+C 退出）",
        env!("CARGO_PKG_VERSION")
    );
    sync::run_daemon(config, cli.interval, cache).await
}

use std::path::PathBuf;

use anyhow::{Context, Result};
use dialoguer::{Input, Password};
use serde::{Deserialize, Serialize};

pub const CONFIG_FILE: &str = "markmax-config.json";
pub const BOOKMARKS_FILE: &str = "bookmarks.json";
pub const FOLDERS_FILE: &str = "folders.json";

/// 全局配置（固定位置 ~/.markmax/markmax-config.json）：
/// 缓存目录 + 服务端连接信息 + 上次同步时间。
/// 之所以放在固定位置，是为了让 native host 模式（插件触发，无参数）也能找到缓存目录。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    pub cache_dir: PathBuf,
    pub server: String,
    pub token: String,
    pub last_sync: i64,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            cache_dir: default_cache_dir(),
            server: "http://localhost:8080".to_string(),
            token: String::new(),
            last_sync: 0,
        }
    }
}

/// 解析后的完整配置（cache_dir 与 sync.cache_dir 保持一致）。
#[derive(Debug, Clone)]
pub struct Config {
    pub cache_dir: PathBuf,
    pub sync: SyncConfig,
}

pub fn default_config_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".markmax")
}

pub fn default_cache_dir() -> PathBuf {
    default_config_dir()
}

pub fn config_path() -> PathBuf {
    default_config_dir().join(CONFIG_FILE)
}

pub fn load() -> Result<Option<SyncConfig>> {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            // 优先按新格式（含 cache_dir）解析
            if let Ok(cfg) = serde_json::from_str::<SyncConfig>(&raw) {
                return Ok(Some(cfg));
            }
            // 兼容旧版格式（配置在缓存目录内、无 cache_dir 字段）→ 迁移
            if let Ok(old) = serde_json::from_str::<LegacyConfig>(&raw) {
                let cfg = SyncConfig {
                    cache_dir: default_cache_dir(),
                    server: old.server,
                    token: old.token,
                    last_sync: old.last_sync,
                };
                save(&cfg)?;
                return Ok(Some(cfg));
            }
            anyhow::bail!("解析配置文件失败: {path:?}");
        }
        Err(_) => Ok(None),
    }
}

#[derive(Debug, Deserialize)]
struct LegacyConfig {
    server: String,
    token: String,
    last_sync: i64,
}

pub fn save(cfg: &SyncConfig) -> Result<()> {
    let dir = default_config_dir();
    std::fs::create_dir_all(&dir).context("创建配置目录失败")?;
    let raw = serde_json::to_string_pretty(cfg).context("序列化配置失败")?;
    std::fs::write(config_path(), raw).context("保存配置文件失败")?;
    Ok(())
}

/// 交互式配置：缓存目录、服务端地址、API token。
pub fn interactive(prefill_dir: Option<PathBuf>) -> Result<Config> {
    tracing::info!("进入交互式配置…");

    let prefill = prefill_dir.unwrap_or_else(default_cache_dir);
    let dir: String = Input::new()
        .with_prompt("缓存目录路径（与 Chrome 插件共享同一目录）")
        .with_initial_text(prefill.display().to_string())
        .interact_text()?;
    let cache_dir = PathBuf::from(dir.trim());
    if cache_dir.as_os_str().is_empty() {
        anyhow::bail!("缓存目录不能为空");
    }

    let server: String = Input::new()
        .with_prompt("服务端地址")
        .with_initial_text("http://localhost:8080".to_string())
        .interact_text()?;

    let token: String = Password::new()
        .with_prompt("API token（服务端日志或 data/token 中查看）")
        .interact()?;

    let sync = SyncConfig {
        cache_dir: cache_dir.clone(),
        server: server.trim().trim_end_matches('/').to_string(),
        token: token.trim().to_string(),
        last_sync: 0,
    };
    save(&sync)?;
    tracing::info!("配置已保存到 {}", config_path().display());
    Ok(Config {
        cache_dir,
        sync,
    })
}

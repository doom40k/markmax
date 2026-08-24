use std::path::PathBuf;

use clap::Parser;
use uuid::Uuid;

#[derive(Parser, Debug, Clone)]
#[command(name = "markmax-server", version, about = "markmax 书签备份与同步服务")]
pub struct Config {
    /// 监听端口
    #[arg(long, env = "MARKMAX_PORT", default_value_t = 8080)]
    pub port: u16,

    /// sqlite 数据库与生成的 API token 存放目录
    #[arg(long, env = "MARKMAX_DATA_DIR", default_value = "./data")]
    pub data_dir: PathBuf,

    /// API token；省略时自动生成并持久化到 <data_dir>/token
    #[arg(long, env = "MARKMAX_TOKEN")]
    pub token: Option<String>,

    /// 管理界面静态目录（默认取 crate 旁的 web/dist）
    #[arg(long, env = "MARKMAX_WEB_DIR")]
    pub web_dir: Option<PathBuf>,
}

impl Config {
    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join("markmax.db")
    }

    pub fn web_dir(&self) -> PathBuf {
        self.web_dir
            .clone()
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web/dist"))
    }

    /// 返回配置的 token；未配置时读取或生成 <data_dir>/token 中的 token。
    pub fn resolve_token(&self) -> String {
        if let Some(token) = self.token.as_ref().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
            return token;
        }
        let token_file = self.data_dir.join("token");
        if let Ok(existing) = std::fs::read_to_string(&token_file).map(|s| s.trim().to_string()) {
            if !existing.is_empty() {
                return existing;
            }
        }
        let generated = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        if let Some(parent) = token_file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(&token_file, &generated).expect("failed to persist API token");
        tracing::info!("已生成新的 API token，并保存到 {}", token_file.display());
        generated
    }
}

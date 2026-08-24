/*!
 * Native Messaging 宿主：插件通过 chrome.runtime.connectNative 与本进程通信。
 *
 * 消息协议（JSON，4 字节小端长度前缀，与 Chrome 扩展规范一致）：
 *   请求: { "id": number, "type": "ping" | "status" | "read" | "write", "bookmarks"?: [...] }
 *   响应: { "id": number, "ok": bool, "data"?: {...}, "error"?: string }
 *
 * 依赖全局配置（~/.markmax/markmax-config.json）定位缓存目录。
 */

use std::io::{Read, Write};

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};

use crate::cache::Cache;
use crate::config;
use crate::models::Bookmark;

pub fn run_native_host() -> Result<()> {
    let mut stdin = std::io::stdin().lock();
    let mut stdout = std::io::stdout().lock();
    loop {
        let mut len_buf = [0u8; 4];
        if stdin.read_exact(&mut len_buf).is_err() {
            break; // 连接关闭
        }
        let len = u32::from_ne_bytes(len_buf) as usize;
        if len == 0 || len > 32 * 1024 * 1024 {
            break;
        }
        let mut buf = vec![0u8; len];
        if stdin.read_exact(&mut buf).is_err() {
            break;
        }
        let msg: Value = serde_json::from_slice(&buf).unwrap_or_else(|_| json!({}));
        let resp = handle_message(&msg);
        let out = serde_json::to_vec(&resp).context("序列化响应失败")?;
        stdout
            .write_all(&(out.len() as u32).to_ne_bytes())
            .context("写入响应失败")?;
        stdout.write_all(&out).context("写入响应失败")?;
        stdout.flush().context("刷新输出失败")?;
    }
    Ok(())
}

fn handle_message(msg: &Value) -> Value {
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let ty = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let result: Result<Value> = match ty {
        "ping" => Ok(json!({ "version": env!("CARGO_PKG_VERSION") })),
        "status" => status(),
        "read" => read_bookmarks(),
        "write" => write_bookmarks(msg),
        _ => Err(anyhow!("未知消息类型: {ty}")),
    };
    let mut resp = json!({ "id": id });
    match result {
        Ok(data) => {
            resp["ok"] = json!(true);
            resp["data"] = data;
        }
        Err(err) => {
            resp["ok"] = json!(false);
            resp["error"] = serde_json::Value::String(err.to_string());
        }
    }
    resp
}

fn require_config() -> Result<config::SyncConfig> {
    config::load()?.context("尚未配置：请先运行 markmax-sync 完成交互式配置")
}

fn status() -> Result<Value> {
    match require_config() {
        Ok(cfg) => {
            let cache = Cache::new(cfg.cache_dir.clone())?;
            let bookmarks = cache.read_bookmarks()?;
            Ok(json!({
                "configured": true,
                "cache_dir": cfg.cache_dir.display().to_string(),
                "server": cfg.server,
                "last_sync": cfg.last_sync,
                "exists": bookmarks.is_some(),
                "count": bookmarks.as_ref().map(|b| b.len()).unwrap_or(0),
            }))
        }
        Err(_) => Ok(json!({ "configured": false })),
    }
}

fn read_bookmarks() -> Result<Value> {
    let cfg = require_config()?;
    let cache = Cache::new(cfg.cache_dir.clone())?;
    let bookmarks = cache.read_bookmarks()?;
    let mtime = cache.bookmarks_mtime()?;
    Ok(json!({
        "exists": bookmarks.is_some(),
        "bookmarks": bookmarks.unwrap_or_default(),
        "mtime": mtime,
    }))
}

fn write_bookmarks(msg: &Value) -> Result<Value> {
    let cfg = require_config()?;
    let bookmarks: Vec<Bookmark> =
        serde_json::from_value(msg.get("bookmarks").cloned().unwrap_or(json!([])))
            .context("bookmarks 字段格式错误")?;
    let cache = Cache::new(cfg.cache_dir.clone())?;
    cache.write_bookmarks(&bookmarks)?;
    Ok(json!({}))
}

/// 注册 Chrome / Chromium 的 Native Messaging 宿主清单（写清单文件即可，无需权限）。
///
/// 注意：Chrome 启动宿主时【不带任何参数】，因此清单必须指向一个包装脚本，
/// 由脚本携带 `--native-host` 参数启动真实二进制。
pub fn install_host_manifest() -> Result<()> {
    let exe = std::env::current_exe().context("获取可执行文件路径失败")?;
    let home = std::env::var("HOME").unwrap_or_default();

    // 生成包装脚本（放配置目录，稳定存在；target 目录可能被 cargo clean 清掉）
    let script_dir = config::default_config_dir();
    std::fs::create_dir_all(&script_dir).context("创建脚本目录失败")?;
    let script = script_dir.join("native-host.sh");
    std::fs::write(
        &script,
        format!("#!/bin/sh\nexec \"{}\" --native-host \"$@\"\n", exe.display()),
    )
    .context("写入宿主脚本失败")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
            .context("设置宿主脚本权限失败")?;
    }
    tracing::info!("已生成宿主脚本: {}", script.display());

    let manifest = json!({
        "name": "markmax_sync",
        "description": "markmax 书签同步宿主（由 Chrome 插件调用，读写共享缓存目录）",
        "path": script.display().to_string(),
        "type": "stdio"
    });

    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    if !home.is_empty() {
        let home = std::path::PathBuf::from(home);
        // Chrome
        dirs.push(home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts"));
        dirs.push(home.join(".config/google-chrome/NativeMessagingHosts"));
        // Chromium
        dirs.push(home.join("Library/Application Support/Chromium/NativeMessagingHosts"));
        dirs.push(home.join(".config/chromium/NativeMessagingHosts"));
        // Brave
        dirs.push(home.join("Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"));
        dirs.push(home.join(".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"));
        // Microsoft Edge
        dirs.push(home.join("Library/Application Support/Microsoft Edge/NativeMessagingHosts"));
        dirs.push(home.join(".config/microsoft-edge/NativeMessagingHosts"));
    }

    let mut installed = 0;
    for dir in &dirs {
        let target = dir.join("markmax_sync.json");
        if let Err(err) = std::fs::create_dir_all(dir) {
            tracing::warn!("无法创建目录 {}: {err}", dir.display());
            continue;
        }
        match serde_json::to_string_pretty(&manifest)
            .map_err(anyhow::Error::from)
            .and_then(|raw| std::fs::write(&target, raw).map_err(anyhow::Error::from))
        {
            Ok(_) => {
                tracing::info!("已注册宿主清单: {}", target.display());
                installed += 1;
            }
            Err(err) => tracing::warn!("写入失败 {}: {err:#}", target.display()),
        }
    }
    if installed == 0 {
        bail!("未能注册宿主清单，请手动创建");
    }
    tracing::info!("请重启 Chrome 后生效");
    Ok(())
}

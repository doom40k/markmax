# markmax

轻量自托管书签管理。Chrome 插件管理书签，服务端集中存储与备份，本机 daemon 自动同步；配套 Alfred 搜索 / 快速新增。

## 架构

```text
┌─────────────┐   REST API    ┌──────────────────┐
│ Chrome 插件  │ ────────────▶ │  服务端 (Rust)    │
│ (增删查改)   │ ◀──────────── │  sqlite + Web UI │
└─────────────┘               └────────▲─────────┘
     │ 读写                             │ POST /api/sync
     ▼                                  │ 双向增量同步
┌──────────────────────────────────────┴─┐
│ ~/.markmax/bookmarks.json（共享缓存）   │
└──────────────▲─────────────────────────┘
               │ 监听文件变化 + 定时拉取
      ┌────────┴─────────┐
      │ markmax-sync CLI │ ← brew services 常驻后台
      └────────▲─────────┘
               │ 直接读写缓存
      ┌────────┴─────────┐
      │ Alfred mk / mka  │
      └──────────────────┘
```

| 目录 | 端 | 说明 |
| --- | --- | --- |
| `server/` | 服务端 | Rust (axum + sqlite) + React/Tailwind 管理界面 |
| `extension/` | Chrome 插件 (MV3) | 直连服务端 REST API，跨浏览器通用 |
| `cli/` | 本机同步工具 | 与插件共享缓存目录，文件变更即时同步 + 定时同步 |
| `alfred/` | Alfred workflow | `mk` 搜索浏览、`mka` 快速新增 |

数据模型（三端统一）：书签为扁平记录，`folder` 为 `/` 分层的字符串路径（如 `工作/项目A`）；时间戳统一 unix 毫秒；删除一律软删除（`deleted` + `deleted_at`），以便多端传播。

```json
{
  "id": "uuid",
  "title": "Example",
  "url": "https://example.com",
  "tags": ["rust", "backend"],
  "notes": "",
  "folder": "work/dev",
  "created_at": 1780000000000,
  "updated_at": 1780000000000,
  "deleted": false,
  "deleted_at": null
}
```

---

## 快速开始

从零到可用共四步：

```bash
# 1. 启动服务端（Docker Hub 镜像，amd64/arm64）
docker run -d --name markmax -p 8080:8080 -v markmax-data:/data \
  --restart unless-stopped doom40k/markmax-server
# token 在日志里打印，同时持久化在容器 /data/token

# 2. 本机安装同步 CLI（Homebrew）
brew tap doom40k/tools https://github.com/doom40k/homebrew-tools
brew install doom40k/tools/markmax

# 3. 配置并常驻后台
markmax-sync --config          # 缓存目录(默认 ~/.markmax) + 服务端地址 + API token
brew services start markmax    # LaunchAgent 常驻，崩溃自动拉起

# 4a. 加载 Chrome 插件：chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选 extension/
#     点插件图标 → 填服务端地址 + token → 连接
# 4b. （可选）安装 Alfred workflow：双击 alfred/dist/markmax.alfredworkflow
```

日常使用：浏览器里用插件或 Web 管理界面（http://localhost:8080）增删改书签 → CLI 自动同步备份到服务端；换机器装同样一套即可拉取全部书签。

---

## server — 服务端

Rust 实现，SQLite（WAL）存储，提供 REST API + 静态托管的 Web 管理界面（React + Tailwind，Vercel 风格黑白配色）。Web 界面支持搜索、新建编辑、文件夹树管理（新建/重命名/删除）、标签过滤、回收站恢复、批量导入书签 HTML。

### 配置

命令行参数与环境变量等价（环境变量优先级低于参数）：

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--port` | `MARKMAX_PORT` | `8080` | 监听端口 |
| `--data-dir` | `MARKMAX_DATA_DIR` | `./data` | sqlite 数据库与 token 存放目录 |
| `--token` | `MARKMAX_TOKEN` | 自动生成 | API token，省略时自动生成并持久化到 `<data-dir>/token` |
| `--web-dir` | `MARKMAX_WEB_DIR` | `web/dist` | 管理界面静态目录 |

所有 `/api/*` 接口（除 `/api/health`）都需要请求头 `Authorization: Bearer <token>`。

### 服务端部署

#### 方式一：Docker（推荐）

官方镜像发布在 Docker Hub（`linux/amd64`）：

```bash
docker run -d --name markmax \
  -p 8080:8080 \
  -v markmax-data:/data \
  --restart unless-stopped \
  doom40k/markmax-server
```

也可以本地从源码构建：`cd server && docker build -t markmax-server .`（把上面命令中的镜像名换成 `markmax-server`）。

容器内可用环境变量：

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `MARKMAX_PORT` | 容器内监听端口（改端口需同时映射 `-p 宿主:容器`） | `8080` |
| `MARKMAX_DATA_DIR` | 数据存储目录（sqlite + token 文件），务必挂载 volume 持久化 | `/data` |
| `MARKMAX_TOKEN` | 固定 API token；不设则首次启动自动生成并持久化到 `<数据目录>/token`，日志中也会打印 | 自动生成 |

自定义示例：

```bash
docker run -d -p 9000:9000 \
  -e MARKMAX_PORT=9000 \
  -e MARKMAX_TOKEN=my-secret-token \
  -v markmax-data:/data \
  doom40k/markmax-server
```

> 注意：不要用 `docker run … markmax-server --port xxx` 覆盖端口——CLI 参数优先级高于环境变量，会令 `MARKMAX_PORT` 失效。镜像已内置默认值，直接用环境变量即可。

升级：主仓库打新 tag 后 CI 自动推送新镜像，`docker pull doom40k/markmax-server && docker rm -f markmax && docker run …`（数据在 volume 中不受影响）。

#### 方式二：直接运行（需要 Rust 工具链）

```bash
# 先构建管理界面
cd server/web && npm install && npm run build && cd ..
cargo build --release

MARKMAX_DATA_DIR=/var/lib/markmax ./target/release/markmax-server
```

生产建议配合 systemd 常驻：

```ini
# /etc/systemd/system/markmax.service
[Unit]
Description=markmax bookmark server
After=network.target

[Service]
ExecStart=/opt/markmax/markmax-server
Environment=MARKMAX_DATA_DIR=/var/lib/markmax
Environment=MARKMAX_PORT=8080
Restart=always
User=markmax

[Install]
WantedBy=multi-user.target
```

`systemctl enable --now markmax` 启动；日志走 journalctl（`journalctl -u markmax -f`）。

#### 反向代理（公网部署）

服务端自带 Bearer token 鉴权，可置于 nginx/caddy 之后对外。建议：

- 仅 HTTPS 暴露（token 明文传输会被截获）
- 不需要改动路径前缀：API 全部在 `/api/*`，界面在根路径

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
}
```

### API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（无需 token） |
| GET | `/api/bookmarks` | 列表；query 参数：`q`（模糊搜索 title/url/notes/tags）、`folder`（前缀匹配，含子文件夹）、`tag`（精确匹配）、`deleted`（`0` 正常 / `1` 回收站）、`limit`（默认 100，最大 5000）、`offset` |
| POST | `/api/bookmarks` | 新建；body：`{ title, url*, tags[], notes, folder }`，`url` 必填，`folder` 自动登记为文件夹 |
| POST | `/api/bookmarks/import` | 批量导入；body：`{ bookmarks: [{ title, url, tags[], notes, folder, created_at? }] }`，单次最多 10000 条，无效记录（url 为空）跳过，单事务插入并自动登记文件夹 |
| PATCH | `/api/bookmarks/{id}` | 局部更新，字段可省略 |
| DELETE | `/api/bookmarks/{id}` | 软删除（移入回收站） |
| POST | `/api/bookmarks/{id}/restore` | 从回收站恢复 |
| GET | `/api/folders` | 文件夹列表（含空文件夹），返回 `{ folders: [{ name, count }] }`，`count` 为精确匹配书签数 |
| POST | `/api/folders` | 新建文件夹；body：`{ name }`，可用 `/` 分层 |
| PATCH | `/api/folders` | 重命名；body：`{ name, new_name }`，子文件夹与书签路径前缀整体跟随 |
| DELETE | `/api/folders` | 删除；body：`{ name }`，其下书签变为未分类（`folder` 置空） |
| POST | `/api/sync` | 同步（见下） |

### 同步协议（POST /api/sync）

CLI 与服务端之间的同步，单次请求完成双向：

```json
// 请求：since 为客户端上次同步时间戳（0 表示全量），changes 为客户端本地自上次同步以来的改动
{ "since": 1780000000000, "changes": [ { ...bookmark } ] }

// 响应：changes 为服务端 updated_at >= since 的全部记录（含软删除，按时间升序）
{ "server_time": 1780000001234, "changes": [ { ...bookmark } ] }
```

- 冲突解决：按 `updated_at` 最后写入者胜（last-write-wins），`id` 相同则比较时间戳。
- 服务端先应用客户端 changes（`created_at` 保留客户端值），再返回客户端缺失的记录。
- 客户端收到响应后同样按 `updated_at` 合并；本端时间戳更新则保留本端。删除通过软删除标记传播。
- 客户端应在合并完成后将本地 `last_sync` 推进为响应中最大的时间戳（无记录时用 `server_time`）。

### 导入书签 HTML

管理界面工具栏的「导入」按钮支持 Chrome、Raindrop 导出的书签 HTML（Netscape 格式）：

- 解析在浏览器端完成（原生 `DOMParser`，无需额外依赖），文件夹层级按 `/` 拼接保留，`TAGS` / `keywords` 属性解析为标签，`ADD_DATE` 保留为创建时间。
- 解析结果先预览（书签数、文件夹数、样例）再确认导入，导入走 `POST /api/bookmarks/import` 批量落库。

---

## cli — 本机同步工具

Rust CLI，作为后台服务运行：**缓存目录下的 bookmarks.json 一变（插件/Alfred 改动），立即同步到服务端；同时每 3 分钟定时拉取服务端变更**，双向同步按 `updated_at` 最后写入者胜。

### 安装（Homebrew）

```bash
brew tap doom40k/tools https://github.com/doom40k/homebrew-tools
brew install doom40k/tools/markmax
```

安装的是 CI 预编译二进制（macOS Apple Silicon / Intel 双架构），无需本地 Rust 环境，秒装。首次使用先在终端完成配置（交互式）：`markmax-sync --config`；无交互终端（如后台服务）下运行会直接报错退出，不会卡在配置流程。

### 后台常驻（brew services）

```bash
brew services start markmax   # 常驻后台（用户态 LaunchAgent，keep_alive 崩溃自动拉起）
brew services stop markmax    # 停止
```

日志输出到 `/tmp/markmax.log`。升级方式：主仓库打新 tag（CI 自动构建双架构产物并附到 release）→ 更新 tap 中 formula 的 version 与 sha256 → `brew upgrade markmax`。

### 从源码构建

```bash
cd cli && cargo install --path .   # 或 cargo build --release
```

首次启动无配置时自动进入交互式配置流程：缓存目录路径、服务端地址、API token（密码式输入）。

| 命令 / 参数 | 说明 |
| --- | --- |
| `markmax-sync` | 启动 daemon：监听缓存变化即时同步 + 定时拉取 |
| `--cache-dir <路径>` | 指定缓存目录（跳过交互） |
| `--server` / `--token` | 覆盖服务端地址 / token |
| `--sync` | 立即同步一次后退出 |
| `--config` | 重新交互式配置 |
| `--interval <秒>` | 定时同步间隔，默认 180（3 分钟） |
| `search <词> [--alfred] [--limit]` | 搜索本地缓存；TSV 输出，`--alfred` 输出 Script Filter JSON |
| `add --url <u> [--title] [--folder] [--tags] [--notify]` | 快速新增一条书签到缓存，daemon 自动同步 |
| `remove <id> [--notify]` | 移入回收站（软删除） |
| `install-alfred` | 把 Alfred workflow 安装到 Alfred 配置目录（注入二进制绝对路径） |

### 缓存目录格式（与 Chrome 插件 / Alfred 共享）

```text
~/.markmax/
├── markmax-config.json  # 全局配置：{ cache_dir, server, token, last_sync }
├── bookmarks.json       # 书签数据（原子写入）
├── folders.json         # 已有文件夹列表（Alfred mka 的选择项来源）
└── token                # （仅服务端）生成的 API token
```

`bookmarks.json` 单条记录结构见文首数据模型。约定：

- 其它进程增删改：直接改写 `bookmarks.json`（保留完整字段即可），CLI 监听文件变化后自动同步。
- 删除用软删除（`deleted: true` + `deleted_at`），同步确认后 CLI 会自动清理 tombstone。
- 同步细节：本地 `updated_at > last_sync` 的记录作为变更推送；响应中时间戳更新的记录覆盖本地；`last_sync` 推进为服务端时间（各端时钟应大致一致）。

---

## extension — Chrome 插件

MV3 插件，Vercel 黑白风格，**直连服务端 REST API**（跨浏览器通用：Chrome / Edge / Brave 等 Chromium 系均可加载）。

### 安装

1. 打开 `chrome://extensions`（Brave 为 `brave://extensions`）→ 开发者模式 → 「加载已解压的扩展程序」→ 选择 `extension/` 目录
2. 点插件图标 → 填写服务端地址（如 http://localhost:8080）与 API token（服务端启动日志或 `server/data/token`）→ 连接

### 功能

- **增删查改**：列表搜索（`/` 聚焦）、新建、编辑、软删除（进回收站）、复制链接、新标签页打开
- **配置引导**：首次使用弹配置表单；token 无效 / 无法连接服务端分别给出明确提示
- **设置页**（选项）：服务端地址 + token 配置、测试连接、书签概况、清除配置
- 权限最小化：仅 `storage`（存配置）+ `host_permissions`（访问服务端 API），无其它权限

> 注：插件直连服务端，不经本地缓存。早期 Native Messaging（读写本地文件）方案因 Brave 清单读取行为不一致而弃用。

---

## alfred — Alfred workflow

依赖已安装的 `markmax-sync` CLI（推荐 brew 安装，或 `cargo install --path cli` 从源码构建）。

### 安装

- **分发包**：双击 `alfred/dist/markmax.alfredworkflow` 导入，脚本自动定位 CLI（`$MARKMAX_CLI` → `PATH` → `~/.cargo/bin`）
- **开发者**：`markmax-sync install-alfred`（把模板复制进 Alfred 配置目录并注入二进制绝对路径）

### 使用

| 关键词 | 功能 |
| --- | --- |
| `mk` | 搜索浏览书签。空查询列出顶层文件夹 + 未分类；`⇥` 进入文件夹（支持多级与继续输入过滤）；输入关键词全局搜索 title/url/notes/tags；`↩` 打开链接，`⌘↩` 复制链接 |
| `mka` | 快速收藏当前页面。需在 Chrome / Edge / Brave / Safari 前台触发，抓取活动标签页；下拉列出已有文件夹（来自 `folders.json`）供选择，回车存入，系统通知确认（带项目图标） |

首次使用 macOS 会请求「自动化」授权，请允许。mk 的防抖节奏可在 Alfred Preferences → 该 workflow 的 Script Filter Run Behaviour 里调整。

---

## 目录结构

```text
bookmark/
├── server/          # 服务端（Rust axum + sqlite + web/ 管理界面 + Dockerfile）
├── extension/       # Chrome 插件（MV3）
├── cli/             # 本机同步工具（Rust CLI）
└── alfred/          # Alfred workflow（template/ 模板，build.sh 打包出 dist/*.alfredworkflow）
```

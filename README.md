# markmax

轻量书签管理服务。三端分离，各自独立目录：

| 目录 | 端 | 状态 |
| --- | --- | --- |
| `server/` | 服务端：Rust (axum + sqlite) + React/Tailwind 管理界面 | ✅ 已实现 |
| `extension/` | Chrome 插件（MV3），增删查改书签，读写本地缓存目录 | ✅ 已实现 |
| `cli/` | 本机同步工具（Rust CLI），与插件共享缓存目录，文件变更即时同步 + 定时同步 | ✅ 已实现 |

数据模型（三端统一）：

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

时间戳统一为 unix 毫秒。删除为软删除（`deleted` / `deleted_at`），以便在多端之间传播删除。

---

## server — 服务端

Rust 实现，SQLite（WAL）存储，提供 REST API + 静态托管的 Web 管理界面（React + Tailwind，Vercel 风格黑白配色）。

### 快速开始

```bash
cd server

# 1. 构建管理界面（产物输出到 server/web/dist，由服务端直接托管）
cd web && npm install && npm run build && cd ..

# 2. 启动服务端
cargo run --release
```

启动后访问 http://localhost:8080 打开管理界面，输入 token 连接。token 在首次启动时生成并打印在日志里，同时持久化到 `data/token`。

### 配置

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--port` | `MARKMAX_PORT` | `8080` | 监听端口 |
| `--data-dir` | `MARKMAX_DATA_DIR` | `./data` | sqlite 数据库与 token 存放目录 |
| `--token` | `MARKMAX_TOKEN` | 自动生成 | API token，省略时自动生成并持久化 |
| `--web-dir` | `MARKMAX_WEB_DIR` | `web/dist` | 管理界面静态目录 |

所有 `/api/*` 接口（除 `/api/health`）都需要请求头 `Authorization: Bearer <token>`。

### API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（无需 token） |
| GET | `/api/bookmarks` | 列表；query 参数：`q`（模糊搜索 title/url/notes/tags）、`folder`（前缀匹配，含子文件夹）、`tag`（精确匹配）、`deleted`（`0` 正常 / `1` 回收站）、`limit`（默认 100，最大 5000）、`offset` |
| POST | `/api/bookmarks` | 新建；body：`{ title, url*, tags[], notes, folder }`，`url` 必填，`folder` 自动登记为文件夹 |
| POST | `/api/bookmarks/import` | 批量导入（管理界面导入功能的落点）；body：`{ bookmarks: [{ title, url, tags[], notes, folder, created_at? }] }`，单次最多 10000 条，无效记录（url 为空）跳过，单事务插入并自动登记文件夹 |
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

### 文件夹说明

- 文件夹是服务端的管理概念：书签的 `folder` 字段仍为普通字符串路径（如 `工作/项目A`），随书签参与同步，协议不变。
- 服务端维护一张 `folders` 表用于管理端展示与操作（新建 / 重命名 / 删除），并在写入书签时自动登记新出现的 `folder`。
- 重命名 / 删除文件夹会批量改写其下书签的 `folder` 并刷新 `updated_at`，因此会通过同步协议传播到所有客户端。

### 部署

```bash
# 方式一：直接部署（需要 Rust 工具链）
cd server && cargo build --release
MARKMAX_PORT=8080 MARKMAX_DATA_DIR=/var/lib/markmax ./target/release/markmax-server

# 方式二：Docker
cd server
docker build -t markmax-server .
docker run -d -p 8080:8080 -v markmax-data:/data markmax-server
```

## cli — 本机同步工具

Rust CLI，作为后台服务运行：**缓存目录下的 bookmarks.json 一变（插件改动），立即同步到服务端；同时每 3 分钟定时拉取服务端变更**，双向同步按 `updated_at` 最后写入者胜。

### 安装（Homebrew）

```bash
brew tap doom40k/tools https://github.com/doom40k/homebrew-tools
brew install doom40k/tools/markmax
```

首次使用先在终端完成配置（交互式）：`markmax-sync --config`。无交互终端（如后台服务）下运行会直接报错退出，不会卡在配置流程。

### 后台常驻（brew services）

```bash
brew services start markmax   # 常驻后台（用户态 LaunchAgent，keep_alive 崩溃自动拉起）
brew services stop markmax    # 停止
```

日志输出到 `/tmp/markmax.log`。升级方式：主仓库打新 tag / release → 更新 tap 中 formula 的 url 与 sha256 → `brew upgrade markmax`。

### 从源码运行

```bash
cd cli && cargo run --release
```

首次启动无配置时自动进入**交互式配置流程**：缓存目录路径（必须与 Chrome 插件使用同一目录）、服务端地址、API token（密码式输入）。

| 参数 | 说明 |
| --- | --- |
| `--cache-dir <路径>` | 指定缓存目录（跳过交互） |
| `--server` / `--token` | 覆盖服务端地址 / token |
| `--sync` | 立即同步一次后退出 |
| `--config` | 重新交互式配置 |
| `--interval <秒>` | 定时同步间隔，默认 180（3 分钟） |
| `install-host` | 注册 Chrome / Chromium 的 Native Messaging 宿主清单（插件通信用） |

后台常驻推荐用 Homebrew 安装后 `brew services start markmax`（见下），无需手动配置 launchd。

### 缓存目录格式（与 Chrome 插件共享）

```text
~/.markmax/
├── markmax-config.json  # 全局配置：{ cache_dir, server, token, last_sync }
└── bookmarks.json       # 书签数据（插件与 CLI 共享，CLI 原子写入）——默认在 ~/.markmax，可用 --cache-dir 改到任意位置
```

`bookmarks.json`：

```json
{
  "version": 1,
  "bookmarks": [ { "id": "…", "title": "…", "url": "…", "tags": ["…"], "notes": "…", "folder": "…", "created_at": 0, "updated_at": 0, "deleted": false, "deleted_at": null } ]
}
```

- 插件增删改：直接改写 `bookmarks.json`（保留完整字段即可），CLI 监听文件变化后自动同步。
- 删除用软删除（`deleted: true` + `deleted_at`），同步确认后 CLI 会自动清理 tombstone。
- 同步细节：本地 `updated_at > last_sync` 的记录作为变更推送；响应中时间戳更新的记录覆盖本地；`last_sync` 推进为服务端时间（各端时钟应大致一致）。

## extension — Chrome 插件

MV3 插件，Vercel 黑白风格。**直连服务端 REST API**（跨浏览器通用，无需本地宿主）。

> 路线说明：早期方案是插件经 Native Messaging 读写本地缓存（速度最快），但在 Brave 上多次尝试均失败（`host not found`，Brave 读取清单的目录在不同版本间行为不一致）。为可靠起见改为直连服务端——服务端在 localhost 时往返 <5ms，体验与本地缓存几乎无差；CLI 仍负责服务端备份、多机同步与本地缓存通道。

### 安装

1. `brave://extensions`（或 chrome://extensions）→ 开发者模式 → 加载已解压的扩展程序 → 选 `extension/` 目录
2. 点插件图标 → 填写服务端地址（默认 http://localhost:8080）与 API token（服务端日志或 `server/data/token`）→ 连接

### 功能

- **增删查改**：列表搜索（`/` 聚焦）、新建、编辑、软删除（进回收站）、复制链接、新标签页打开
- **配置引导**：首次使用弹配置表单；token 无效 / 无法连接服务端分别给出明确提示
- **设置页**（选项）：服务端地址 + token 配置、测试连接、书签概况、清除配置
- 权限最小化：仅 `storage`（存配置）+ `host_permissions`（访问服务端 API），无其它权限

## 目录规划

```text
bookmark/
├── server/          # 服务端（Rust + web/ 管理界面）
├── extension/       # Chrome 插件（后续）
└── cli/             # 本机同步工具（后续）
```

插件与 CLI 的本地缓存约定将在实现 `cli/` 时定义（两者共享同一缓存目录）。

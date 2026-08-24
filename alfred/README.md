# markmax Alfred 书签插件

在 Alfred 中搜索与快速新增 markmax 书签，直接读写本机缓存（`~/.markmax/`），由 `markmax-sync` daemon 自动同步到服务端。

## 功能

| 关键词 | 说明 |
|--------|------|
| `mk`   | 搜索书签。空查询列出顶层文件夹 + 未分类；`⇥` 进入文件夹浏览（支持子文件夹与继续过滤）；输入关键词全局搜索 title/url/notes/tags。`↩` 打开链接，`⌘↩` 复制链接 |
| `mka`  | 新增书签。在 Chrome / Edge / Brave / Safari **前台**触发，取当前活动标签页；下拉首项预览（回车存为未分类），其后列出已有文件夹供选择 |

> mka 只认当前前台应用：不在上述浏览器前台时触发无效（显示提示），不做其它浏览器的兜底猜测。
> 不支持创建新文件夹：文件夹列表来自 CLI 维护的 `~/.markmax/folders.json`。

## 安装

前置：已构建并安装 markmax-sync CLI：

```bash
cd cli && cargo install --path .
```

方式一（分发包）：双击 `dist/markmax.alfredworkflow` 导入 Alfred，脚本会自动定位 CLI 二进制（`$MARKMAX_CLI` → `PATH` → `~/.cargo/bin`）。

方式二（开发者）：

```bash
cd cli && ./target/debug/markmax-sync install-alfred
```

该命令把模板复制到 Alfred 配置目录并注入二进制绝对路径。

打包分发：`./build.sh` → 生成 `dist/markmax.alfredworkflow`。

## 权限

首次使用时 macOS 会请求「自动化」授权（System Events 前台探测 + 各目标浏览器各一次），请允许。若曾拒绝：系统设置 → 隐私与安全性 → 自动化 中重新开启。

## 防抖说明

mk 的搜索防抖由 info.plist 中 Script Filter 的 Run Behaviour（自动运行延迟 ~200ms）实现。如需调整节奏，可在 Alfred Preferences → Workflows → markmax 书签 中修改 Script Filter 的 Run Behaviour。

## 已知限制

- 页面标题含换行等控制字符时会被剔除（仅影响显示）。
- folders.json 由每次书签写入自动刷新；全新环境请先跑一次同步或新增一条书签生成它。

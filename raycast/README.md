# markmax Raycast 插件

在 Raycast 中搜索浏览与快速收藏 markmax 书签。与 Alfred 插件（`alfred/`）功能对等，**直接读写本机缓存 `~/.markmax/`**，不依赖 CLI 二进制参与搜索/写入。

## 功能

| 命令 | 说明 |
| --- | --- |
| 搜索书签（search） | 空查询列出顶层文件夹 + 未分类（含条目数）；↩ 进入文件夹逐级浏览；输入关键词全局搜索 title/url/notes/tags/folder。↩ 打开链接，⌘C 复制链接，⇧⌘C 复制标题 |
| 收藏当前页面（add-bookmark） | 抓取浏览器当前活动标签页（Chrome / Edge / Brave / Safari / Arc 等 Raycast 支持的浏览器）；首项「存为未分类」，其余为已有文件夹列表（来自 `folders.json`），回车存入并弹 toast 确认 |

## 安装

前置：本机缓存已存在（装过 CLI 并同步过，或至少在 Web 端/插件用过）。**CLI daemon（`brew services start markmax`）需常驻**——它负责把缓存同步到服务端，并保持缓存随服务端变化更新。

**方式一（推荐）：Raycast 导入**

Raycast 设置 → Extensions → + → Import Extension → 选择 `raycast/` 目录。Raycast 会自动安装依赖并构建，之后两条命令常驻可用，无需任何后台进程。

**方式二（开发模式，仅改代码时需要）**

```bash
cd raycast
npm install
npm run dev     # 热重载：改代码即时生效；停止后扩展仍可用最后一次构建的产物
```

## 配置

扩展偏好项「缓存目录」默认 `~/.markmax`，与 CLI daemon 的缓存目录保持一致即可（一般无需修改）。

## 与 Alfred 插件的关系

两者读写同一个本机缓存，可并存使用：

- 搜索：都直接读 `bookmarks.json`，毫秒级出结果
- 新增：Alfred 经 CLI 写入；Raycast 直接原子写缓存（tmp + rename），CLI daemon 监听文件变化后自动同步到服务端，并刷新 `folders.json`
- 缓存格式是开放约定（见主 README「缓存目录格式」），欢迎照此再写其它效率工具的插件

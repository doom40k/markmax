import { ActionPanel, BrowserExtension, getPreferenceValues, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { addBookmark, readFolders, resolveCacheDir } from "./cache";
import { TabInfo } from "./types";

interface Preferences {
  cacheDir?: string;
}

/**
 * mka 等价命令：抓取浏览器当前活动标签页，选择文件夹后写入本机缓存。
 * 与 Alfred mka 一致：首项为「存为未分类」，其后为已有文件夹列表（folders.json）。
 * 写入由 CLI daemon 监听并自动同步到服务端。
 */
export default function AddBookmark() {
  const { pop } = useNavigation();
  const preferences = getPreferenceValues<Preferences>();
  const cacheDir = resolveCacheDir(preferences.cacheDir);

  const [tab, setTab] = useState<TabInfo | null>(null);
  const [error, setError] = useState<string>("");
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    getSelectedTab();
  }, []);

  async function getSelectedTab() {
    try {
      // 新版 BrowserExtension API：返回所有标签页，取活动标签（需安装 Raycast 浏览器扩展，首次使用会引导授权）
      const tabs = await BrowserExtension.getTabs();
      const active = tabs.find((t) => t.active) ?? tabs[0];
      if (!active || !active.url) {
        setError("未获取到活动标签页（需在浏览器前台触发）");
        return;
      }
      setTab({ title: active.title ?? "", url: active.url });
    } catch (e) {
      setError(`获取标签页失败：${String(e)}`);
    }
  }

  const folders = useMemo(() => readFolders(cacheDir), [cacheDir]);
  const filteredFolders = useMemo(
    () => (searchText.trim() ? folders.filter((f) => f.toLowerCase().includes(searchText.trim().toLowerCase())) : folders),
    [folders, searchText],
  );

  async function save(folder: string) {
    if (!tab) return;
    try {
      addBookmark(cacheDir, tab, folder);
      await showToast({ style: Toast.Style.Success, title: "已收藏", message: tab.title || tab.url });
      pop();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "保存失败", message: String(e) });
    }
  }

  if (error) {
    return (
      <List searchBarPlaceholder="…">
        <List.Item title="无法获取当前标签页" subtitle={{ value: error, tooltip: error }} icon={Icon.Warning} />
      </List>
    );
  }

  if (!tab) {
    return (
      <List searchBarPlaceholder="…">
        <List.Item title="获取标签页…" icon={Icon.Ellipsis} />
      </List>
    );
  }

  return (
    <List
      navigationTitle="收藏当前页面"
      searchBarPlaceholder="选择文件夹（回车存入，不选即未分类）…"
      searchText={searchText}
      onSearchTextChange={setSearchText}
      throttle
    >
      <List.Item
        key="save-uncat"
        title={tab.title || tab.url}
        subtitle={{ value: "存为未分类", tooltip: tab.url }}
        icon={Icon.PlusCircle}
        actions={
          <ActionPanel>
            <ActionPanel.Item title="保存为未分类" icon={Icon.Checkmark} onAction={() => void save("")} />
          </ActionPanel>
        }
      />
      {filteredFolders.map((f) => (
        <List.Item
          key={`folder:${f}`}
          title={f}
          subtitle={{ value: "文件夹", tooltip: f }}
          icon={Icon.Folder}
          actions={
            <ActionPanel>
              <ActionPanel.Item title={`保存到「${f}」`} icon={Icon.Checkmark} onAction={() => void save(f)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

import { Action, ActionPanel, Icon, List, useNavigation, getPreferenceValues, type ReactElement } from "@raycast/api";
import { useMemo, useState } from "react";
import { matchesWords, readBookmarks, resolveCacheDir } from "./cache";
import { Bookmark } from "./types";

interface Preferences {
  cacheDir?: string;
}

/** 搜索文本拆词（小写、空白分隔）。 */
function wordsOf(q: string): string[] {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** 某前缀下（含子文件夹）的顶层段计数：segment → 书签数。 */
function segmentCounts(live: Bookmark[], prefix: string): Map<string, number> {
  const counts = new Map<string, number>();
  const base = prefix ? `${prefix}/` : "";
  for (const b of live) {
    const rest = b.folder.startsWith(base) ? b.folder.slice(base.length) : null;
    if (rest === null || rest === "") continue;
    const seg = rest.split("/")[0];
    if (!seg) continue;
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  return counts;
}

/** 书签列表项：↩ 打开链接，⌘C 复制链接，⇧⌘C 复制标题。 */
function BookmarkItem({ b }: { b: Bookmark }): ReactElement {
  return (
    <List.Item
      title={b.title || b.url}
      subtitle={b.folder ? { value: b.folder, tooltip: b.folder } : undefined}
      accessories={b.tags.length ? [{ tag: b.tags.join(", ") }] : undefined}
      icon={Icon.Link}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={b.url} title="打开链接" />
          <Action.CopyToClipboard content={b.url} title="复制链接" shortcut={{ modifiers: ["cmd"], key: "c" }} />
          <Action.CopyToClipboard content={b.title} title="复制标题" shortcut={{ modifiers: ["cmd", "shift"], key: "c" }} />
        </ActionPanel>
      }
    />
  );
}

/** 某个文件夹前缀下的浏览视图：子文件夹段 + 前缀内书签（含子文件夹）。 */
function FolderView({ prefix, cacheDir }: { prefix: string; cacheDir: string }) {
  const [searchText, setSearchText] = useState("");

  const live = useMemo(() => readBookmarks(cacheDir).filter((b) => !b.deleted), [cacheDir]);
  const words = wordsOf(searchText);

  const childSegments = useMemo(
    () =>
      [...segmentCounts(live, prefix).entries()]
        .filter(([seg]) => words.every((w) => seg.toLowerCase().includes(w)))
        .sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN")),
    [live, prefix, words],
  );

  const hits = useMemo(
    () =>
      live
        .filter((b) => (b.folder === prefix || b.folder.startsWith(`${prefix}/`)) && matchesWords(b, words))
        .sort((a, b) => b.updated_at - a.updated_at),
    [live, prefix, words],
  );

  return (
    <List
      navigationTitle={prefix}
      searchBarPlaceholder={`在 ${prefix} 中过滤…`}
      searchText={searchText}
      onSearchTextChange={setSearchText}
    >
      {childSegments.map(([seg, count]) => {
        const full = `${prefix}/${seg}`;
        return (
          <List.Item
            key={`folder:${full}`}
            title={seg}
            subtitle={{ value: "文件夹", tooltip: full }}
            accessories={[{ text: `${count} 条` }]}
            icon={Icon.Folder}
            actions={
              <ActionPanel>
                <Action.Push title="进入文件夹" icon={Icon.ArrowRight} target={<FolderView prefix={full} cacheDir={cacheDir} />} />
                <Action.CopyToClipboard content={full} title="复制路径" />
              </ActionPanel>
            }
          />
        );
      })}
      {hits.map((b) => (
        <BookmarkItem key={b.id} b={b} />
      ))}
      {childSegments.length === 0 && hits.length === 0 && <List.EmptyView title="无匹配结果" icon={Icon.MagnifyingGlass} />}
    </List>
  );
}

/** 未分类浏览视图（folder 为空的书签）。 */
function UncatView({ cacheDir }: { cacheDir: string }) {
  const [searchText, setSearchText] = useState("");
  const live = useMemo(() => readBookmarks(cacheDir).filter((b) => !b.deleted && !b.folder), [cacheDir]);
  const words = wordsOf(searchText);
  const hits = live.filter((b) => matchesWords(b, words)).sort((a, b) => b.updated_at - a.updated_at);

  return (
    <List
      navigationTitle="未分类"
      searchBarPlaceholder="在未分类中过滤…"
      searchText={searchText}
      onSearchTextChange={setSearchText}
    >
      {hits.map((b) => (
        <BookmarkItem key={b.id} b={b} />
      ))}
      {hits.length === 0 && <List.EmptyView title="无匹配结果" icon={Icon.MagnifyingGlass} />}
    </List>
  );
}

/** mk 等价命令：空查询列出顶层文件夹 + 未分类；有关键词时全局搜索（含文件夹名命中可直接进入）。 */
export default function SearchBookmarks() {
  const { push } = useNavigation();
  const preferences = getPreferenceValues<Preferences>();
  const cacheDir = resolveCacheDir(preferences.cacheDir);
  const [searchText, setSearchText] = useState("");

  const live = useMemo(() => readBookmarks(cacheDir).filter((b) => !b.deleted), [cacheDir]);
  const folders = useMemo(() => readFolders(cacheDir), [cacheDir]);
  const words = wordsOf(searchText);

  const untaggedCount = useMemo(() => live.filter((b) => !b.folder).length, [live]);
  const segments = useMemo(
    () => [...segmentCounts(live, "").entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN")),
    [live],
  );
  const hits = useMemo(() => live.filter((b) => matchesWords(b, words)).sort((a, b) => b.updated_at - a.updated_at), [live, words]);
  const folderHits = useMemo(
    () => (searchText.trim() ? folders.filter((f) => words.some((w) => f.toLowerCase().includes(w))) : []),
    [folders, searchText, words],
  );

  const showRoot = words.length === 0;

  const folderActions = (path: string): ReactElement => (
    <ActionPanel>
      <Action.Push title="进入文件夹" icon={Icon.ArrowRight} target={<FolderView prefix={path} cacheDir={cacheDir} />} />
      <Action.CopyToClipboard content={path} title="复制路径" />
    </ActionPanel>
  );

  return (
    <List searchBarPlaceholder="搜索书签，或选择文件夹进入…" searchText={searchText} onSearchTextChange={setSearchText} throttle>
      {showRoot && untaggedCount > 0 && (
        <List.Item
          key="folder:~"
          title="未分类"
          accessories={[{ text: `${untaggedCount} 条` }]}
          icon={Icon.Tray}
          actions={
            <ActionPanel>
              <Action.Push title="进入" icon={Icon.ArrowRight} target={<UncatView cacheDir={cacheDir} />} />
            </ActionPanel>
          }
        />
      )}
      {showRoot &&
        segments.map(([seg, count]) => (
          <List.Item
            key={`folder:${seg}`}
            title={seg}
            subtitle={{ value: "文件夹", tooltip: seg }}
            accessories={[{ text: `${count} 条` }]}
            icon={Icon.Folder}
            actions={folderActions(seg)}
          />
        ))}
      {!showRoot &&
        folderHits.map((f) => (
          <List.Item key={`folderhit:${f}`} title={f} subtitle={{ value: "文件夹", tooltip: f }} icon={Icon.Folder} actions={folderActions(f)} />
        ))}
      {!showRoot && hits.map((b) => <BookmarkItem key={b.id} b={b} />)}
      {!showRoot && hits.length === 0 && folderHits.length === 0 && <List.EmptyView title="无匹配结果" icon={Icon.MagnifyingGlass} />}
    </List>
  );
}

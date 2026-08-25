import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Bookmark, BookmarksFile, FoldersFile, TabInfo } from "./types";

/** 解析缓存目录：偏好值（支持 ~ 前缀）或默认 ~/.markmax */
export function resolveCacheDir(preference?: string): string {
  const raw = preference?.trim() || "~/.markmax";
  return raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
}

/** 读取书签缓存；文件不存在或损坏时返回空数组，不抛错（搜索场景容错）。 */
export function readBookmarks(dir: string): Bookmark[] {
  try {
    const file = JSON.parse(fs.readFileSync(path.join(dir, "bookmarks.json"), "utf-8")) as BookmarksFile;
    return Array.isArray(file.bookmarks) ? file.bookmarks : [];
  } catch {
    return [];
  }
}

/** 读取文件夹列表（folders.json 由 CLI daemon 在每次写入时维护）。 */
export function readFolders(dir: string): string[] {
  try {
    const file = JSON.parse(fs.readFileSync(path.join(dir, "folders.json"), "utf-8")) as FoldersFile;
    return Array.isArray(file.folders) ? file.folders : [];
  } catch {
    return [];
  }
}

/**
 * 新增书签：头部插入 + 原子写入（tmp + rename，与 CLI 的写入方式一致），
 * 并同步刷新 folders.json（非空 folder 全集去重升序），保持与 CLI/Alfred 共享的缓存约定。
 */
export function addBookmark(dir: string, tab: TabInfo, folder: string): void {
  const bookmarks = readBookmarks(dir);
  const now = Date.now();
  const bookmark: Bookmark = {
    id: crypto.randomUUID(),
    title: tab.title.trim(),
    url: tab.url.trim(),
    tags: [],
    notes: "",
    folder: folder.trim(),
    created_at: now,
    updated_at: now,
    deleted: false,
    deleted_at: null,
  };
  bookmarks.unshift(bookmark);

  fs.mkdirSync(dir, { recursive: true });
  atomicWrite(path.join(dir, "bookmarks.json"), JSON.stringify({ version: 1, bookmarks }, null, 2));
  const folders = [...new Set(bookmarks.map((b) => b.folder).filter((f) => f))].sort();
  atomicWrite(path.join(dir, "folders.json"), JSON.stringify({ version: 1, folders }, null, 2));
}

function atomicWrite(target: string, content: string): void {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
}

/** 多关键词 AND 匹配 title/url/notes/tags/folder（与 Alfred mk 的匹配语义一致）。 */
export function matchesWords(b: Bookmark, words: string[]): boolean {
  if (words.length === 0) return true;
  const haystack = [b.title, b.url, b.notes, b.tags.join(" "), b.folder].join(" ").toLowerCase();
  return words.every((w) => haystack.includes(w));
}

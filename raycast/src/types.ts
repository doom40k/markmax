export interface Bookmark {
  id: string
  title: string
  url: string
  tags: string[]
  notes: string
  folder: string
  created_at: number
  updated_at: number
  deleted: boolean
  deleted_at: number | null
}

export interface BookmarksFile {
  version: number
  bookmarks: Bookmark[]
}

export interface FoldersFile {
  version: number
  folders: string[]
}

/** 浏览器活动标签页（Raycast getSelectedBrowserTab 的子集） */
export interface TabInfo {
  title: string
  url: string
}

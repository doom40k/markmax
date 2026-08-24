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

export interface BookmarkInput {
  title: string
  url: string
  tags: string[]
  notes: string
  folder: string
}

export interface ListResponse {
  bookmarks: Bookmark[]
  total: number
}

export interface FolderInfo {
  name: string
  count: number
}

export interface FolderListResponse {
  folders: FolderInfo[]
}

export interface ImportItem {
  title: string
  url: string
  tags: string[]
  notes?: string
  folder: string
  created_at?: number
}

export interface ImportResponse {
  created: number
  skipped: number
}

export interface HealthResponse {
  status: string
  version: string
  time: number
}

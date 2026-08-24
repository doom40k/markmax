import type {
  Bookmark,
  BookmarkInput,
  FolderInfo,
  FolderListResponse,
  HealthResponse,
  ImportItem,
  ImportResponse,
  ListResponse,
} from './types'

export class AuthError extends Error {}

export interface Session {
  base: string
  token: string
}

export type Api = ReturnType<typeof createApi>

export function createApi({ base, token }: Session) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }

  async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers } })
    if (res.status === 401) throw new AuthError('未授权')
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) message = body.error
      } catch {
        // 保留基于状态码的提示
      }
      throw new Error(message)
    }
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }

  return {
    health: () => req<HealthResponse>('/api/health'),
    list: (deleted = false, limit = 5000) =>
      req<ListResponse>(`/api/bookmarks?deleted=${deleted ? 1 : 0}&limit=${limit}`),
    create: (input: BookmarkInput) =>
      req<Bookmark>('/api/bookmarks', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: Partial<BookmarkInput>) =>
      req<Bookmark>(`/api/bookmarks/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => req<void>(`/api/bookmarks/${id}`, { method: 'DELETE' }),
    restore: (id: string) => req<Bookmark>(`/api/bookmarks/${id}/restore`, { method: 'POST' }),
    listFolders: () => req<FolderListResponse>('/api/folders'),
    createFolder: (name: string) =>
      req<FolderInfo>('/api/folders', { method: 'POST', body: JSON.stringify({ name }) }),
    renameFolder: (name: string, newName: string) =>
      req<FolderInfo>('/api/folders', { method: 'PATCH', body: JSON.stringify({ name, new_name: newName }) }),
    deleteFolder: (name: string) =>
      req<void>('/api/folders', { method: 'DELETE', body: JSON.stringify({ name }) }),
    importBookmarks: (bookmarks: ImportItem[]) =>
      req<ImportResponse>('/api/bookmarks/import', {
        method: 'POST',
        body: JSON.stringify({ bookmarks }),
      }),
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthError, type Api } from './api'
import type { Bookmark, BookmarkInput, FolderInfo, ImportItem } from './types'
import { BookmarkForm } from './components/BookmarkForm'
import { BookmarkList } from './components/BookmarkList'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ImportModal } from './components/ImportModal'
import { Sidebar } from './components/Sidebar'
import { Toast } from './components/Toast'
import { Toolbar } from './components/Toolbar'

export type View = 'all' | 'trash'

interface Props {
  api: Api
  onDisconnect: () => void
}

export function Console({ api, onDisconnect }: Props) {
  const [all, setAll] = useState<Bookmark[]>([])
  const [trash, setTrash] = useState<Bookmark[]>([])
  const [folderInfos, setFolderInfos] = useState<FolderInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<View>('all')
  const [q, setQ] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editing, setEditing] = useState<Bookmark | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Bookmark | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const [a, t, f] = await Promise.all([api.list(false), api.list(true), api.listFolders()])
      setAll(a.bookmarks)
      setTrash(t.bookmarks)
      setFolderInfos(f.folders)
      setLoaded(true)
    } catch (err) {
      if (err instanceof AuthError) onDisconnect()
    }
  }, [api, onDisconnect])

  const refreshFolders = useCallback(async () => {
    try {
      const f = await api.listFolders()
      setFolderInfos(f.folders)
    } catch (err) {
      if (err instanceof AuthError) onDisconnect()
    }
  }, [api, onDisconnect])

  useEffect(() => {
    refresh()
  }, [refresh])

  // “/” 键聚焦搜索框
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement
      if (e.key === '/' && el?.tagName !== 'INPUT' && el?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const notify = useCallback((msg: string) => setToast(msg), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const folderNames = useMemo(() => folderInfos.map((f) => f.name), [folderInfos])
  const untaggedCount = useMemo(() => all.filter((b) => !b.folder).length, [all])

  const tags = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of all) for (const t of b.tags) m.set(t, (m.get(t) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [all])

  const visible = useMemo(() => {
    const base = view === 'all' ? all : trash
    const needle = q.trim().toLowerCase()
    return base
      .filter((b) => {
        if (folder === null) return true
        if (folder === '') return !b.folder // 未分类
        return b.folder === folder || b.folder.startsWith(folder + '/')
      })
      .filter((b) => !tag || b.tags.includes(tag))
      .filter((b) => {
        if (!needle) return true
        return (
          b.title.toLowerCase().includes(needle) ||
          b.url.toLowerCase().includes(needle) ||
          b.notes.toLowerCase().includes(needle) ||
          b.tags.some((t) => t.toLowerCase().includes(needle))
        )
      })
      .sort((a, b) => b.updated_at - a.updated_at)
  }, [all, trash, view, q, folder, tag])

  async function handleCreate(input: BookmarkInput) {
    const created = await api.create(input)
    setAll((prev) => [created, ...prev])
    await refreshFolders()
    notify('书签已创建')
  }

  async function handleUpdate(id: string, input: BookmarkInput) {
    const updated = await api.update(id, input)
    setAll((prev) => prev.map((b) => (b.id === id ? updated : b)))
    setTrash((prev) => prev.map((b) => (b.id === id ? updated : b)))
    await refreshFolders()
    notify('书签已更新')
  }

  async function handleDelete(b: Bookmark) {
    setDeleteTarget(b)
  }

  async function handleDeleteConfirmed(b: Bookmark) {
    await api.remove(b.id)
    setDeleteTarget(null)
    setAll((prev) => prev.filter((x) => x.id !== b.id))
    setTrash((prev) => [b, ...prev])
    await refreshFolders()
    notify('已移入回收站')
  }

  async function handleRestore(b: Bookmark) {
    const restored = await api.restore(b.id)
    setTrash((prev) => prev.filter((x) => x.id !== b.id))
    setAll((prev) => [restored, ...prev])
    await refreshFolders()
    notify('已恢复')
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      notify('链接已复制')
    } catch {
      notify('复制失败')
    }
  }

  async function handleCreateFolder(name: string) {
    await api.createFolder(name)
    await refreshFolders()
    notify(`文件夹「${name}」已创建`)
  }

  async function handleRenameFolder(oldName: string, newName: string) {
    await api.renameFolder(oldName, newName)
    await refreshFolders()
    setFolder((f) => (f === oldName || f?.startsWith(oldName + '/') ? null : f))
    notify(`已重命名为「${newName}」`)
  }

  async function handleDeleteFolder(name: string) {
    await api.deleteFolder(name)
    await refreshFolders()
    setFolder((f) => (f === name || f?.startsWith(name + '/') ? null : f))
    notify('文件夹已删除')
  }

  async function handleImport(items: ImportItem[]) {
    const res = await api.importBookmarks(items)
    await refresh()
    notify(`已导入 ${res.created} 条书签`)
    return res
  }

  function openForm(bookmark?: Bookmark) {
    setEditing(bookmark ?? null)
    setFormOpen(true)
  }

  return (
    <div className="flex h-screen bg-white text-black">
      <Sidebar
        view={view}
        onViewChange={(v) => {
          setView(v)
          setFolder(null)
          setTag(null)
        }}
        folder={folder}
        tag={tag}
        onFolderChange={setFolder}
        onTagChange={setTag}
        folderInfos={folderInfos}
        tags={tags}
        allCount={all.length}
        trashCount={trash.length}
        untaggedCount={untaggedCount}
        server={api.base}
        onDisconnect={onDisconnect}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <Toolbar
          q={q}
          onQChange={setQ}
          searchRef={searchRef}
          onNew={() => openForm()}
          onImport={() => setImportOpen(true)}
        />
        <div className="flex-1 overflow-y-auto px-8 pb-16">
          <div className="mx-auto max-w-3xl">
            {!loaded ? (
              <p className="py-24 text-center font-mono text-xs uppercase tracking-[0.3em] text-[#999]">
                加载中…
              </p>
            ) : (
              <BookmarkList
                bookmarks={visible}
                view={view}
                onEdit={openForm}
                onDelete={handleDelete}
                onRestore={handleRestore}
                onCopy={handleCopy}
              />
            )}
          </div>
        </div>
      </main>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onImport={handleImport} />}
      {formOpen && (
        <BookmarkForm
          bookmark={editing}
          folders={folderNames}
          onClose={() => setFormOpen(false)}
          onSave={async (input) => {
            if (editing) await handleUpdate(editing.id, input)
            else await handleCreate(input)
            setFormOpen(false)
            void refreshFolders()
          }}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="移入回收站"
          message={`将「${deleteTarget.title || deleteTarget.url}」移入回收站？`}
          confirmText="移入回收站"
          onConfirm={() => void handleDeleteConfirmed(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      <Toast message={toast} />
    </div>
  )
}

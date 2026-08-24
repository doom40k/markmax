import { useEffect, useState, type FormEvent } from 'react'
import type { Bookmark, BookmarkInput } from '../types'
import { FolderSelect } from './FolderSelect'
import { TagInput } from './TagInput'

interface Props {
  bookmark: Bookmark | null
  folders: string[]
  onClose: () => void
  onSave: (input: BookmarkInput) => Promise<void>
}

const inputCls =
  'h-10 w-full rounded-md border border-[#d4d4d4] bg-white px-3 text-sm text-black placeholder:text-[#bbb] focus:border-black focus:outline-none focus:ring-2 focus:ring-[#e5e5e5]'

const labelCls = 'mb-1.5 block font-mono text-[11px] uppercase tracking-[0.12em] text-[#666]'

export function BookmarkForm({ bookmark, folders, onClose, onSave }: Props) {
  const [title, setTitle] = useState(bookmark?.title ?? '')
  const [url, setUrl] = useState(bookmark?.url ?? '')
  const [folder, setFolder] = useState(bookmark?.folder ?? '')
  const [tags, setTags] = useState<string[]>(bookmark?.tags ?? [])
  const [notes, setNotes] = useState(bookmark?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const u = url.trim()
    if (!u) {
      setError('网址不能为空')
      return
    }
    setSaving(true)
    try {
      await onSave({ title: title.trim(), url: u, folder: folder.trim(), tags, notes: notes.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl border border-[#e5e5e5] bg-white p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-[#999]">
            {bookmark ? '编辑书签' : '新建书签'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-sm text-[#999] transition-colors hover:text-black"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>标题</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="示例文档"
              spellCheck={false}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>
              网址 <span className="text-[#bbb]">*</span>
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              spellCheck={false}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>文件夹</label>
              <FolderSelect folders={folders} value={folder} onChange={setFolder} />
            </div>
            <div>
              <label className={labelCls}>标签</label>
              <TagInput value={tags} onChange={setTags} />
            </div>
          </div>
          <div>
            <label className={labelCls}>备注</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="值得记住的内容…"
              className="w-full rounded-md border border-[#d4d4d4] bg-white px-3 py-2 text-sm placeholder:text-[#bbb] focus:border-black focus:outline-none focus:ring-2 focus:ring-[#e5e5e5]"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-[#d4d4d4] px-4 text-sm text-[#444] transition-colors hover:border-black hover:text-black"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-9 rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:bg-[#ccc]"
          >
            {saving ? '保存中…' : bookmark ? '保存修改' : '创建书签'}
          </button>
        </div>
      </form>
    </div>
  )
}

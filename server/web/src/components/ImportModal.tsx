import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { ImportItem } from '../types'
import { parseBookmarkHtml } from '../lib/importHtml'

interface Props {
  onClose: () => void
  onImport: (items: ImportItem[]) => Promise<{ created: number; skipped: number }>
}

type Phase = 'pick' | 'review' | 'importing' | 'done'

const labelCls = 'mb-1.5 block font-mono text-[11px] uppercase tracking-[0.12em] text-[#666]'

export function ImportModal({ onClose, onImport }: Props) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [items, setItems] = useState<ImportItem[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // 导入中不允许关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && phase !== 'importing') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onClose])

  async function handleFile(file: File | null | undefined) {
    if (!file) return
    setError(null)
    try {
      const parsed = parseBookmarkHtml(await file.text())
      if (parsed.items.length === 0) {
        setError('文件中没有解析到书签。请确认是 Chrome 或 Raindrop 导出的书签 HTML。')
        return
      }
      setItems(parsed.items)
      setFolders(parsed.folders)
      setFileName(file.name)
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败')
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void handleFile(e.dataTransfer.files[0])
  }

  async function start() {
    setPhase('importing')
    try {
      const res = await onImport(items)
      setResult(res)
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
      setPhase('review')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && phase !== 'importing') onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-[#e5e5e5] bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-[#999]">导入书签</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === 'importing'}
            className="font-mono text-sm text-[#999] transition-colors hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {phase === 'pick' && (
          <div className="space-y-4">
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click()
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center transition-colors ${
                dragging ? 'border-black bg-[#fafafa]' : 'border-[#d4d4d4] hover:border-black hover:bg-[#fafafa]'
              }`}
            >
              <span className="text-2xl">⇪</span>
              <p className="text-sm font-medium text-black">点击选择或拖拽 HTML 文件到此处</p>
              <p className="font-mono text-[11px] text-[#999]">
                支持 Chrome、Raindrop 导出的书签 HTML（Netscape 格式）
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".html,.htm,text/html"
              className="hidden"
              onChange={(e) => {
                void handleFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        )}

        {phase === 'review' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border border-[#e5e5e5] bg-[#fafafa] px-4 py-3">
              <div>
                <p className="truncate text-sm font-medium text-black" title={fileName}>
                  {fileName}
                </p>
                <p className="font-mono text-[11px] text-[#999]">
                  {items.length} 条书签 · {folders.length} 个文件夹
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPhase('pick')
                  setError(null)
                }}
                className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-[#666] hover:text-black"
              >
                重新选择
              </button>
            </div>

            <div>
              <label className={labelCls}>预览（前 {Math.min(items.length, 8)} 条）</label>
              <ul className="max-h-52 divide-y divide-[#e5e5e5] overflow-y-auto rounded-md border border-[#e5e5e5]">
                {items.slice(0, 8).map((item, i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-black font-mono text-[10px] text-white">
                      {(item.title || item.url)[0]?.toUpperCase() ?? '·'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-black">
                        {item.title || item.url}
                      </p>
                      <p className="truncate font-mono text-[11px] text-[#999]">
                        {item.folder ? `${item.folder} / ` : ''}
                        {item.url}
                      </p>
                    </div>
                    {item.tags.length > 0 && (
                      <span className="shrink-0 font-mono text-[10px] text-[#666]">
                        #{item.tags.slice(0, 2).join(' #')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-md border border-[#d4d4d4] px-4 text-sm text-[#444] transition-colors hover:border-black hover:text-black"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void start()}
                className="h-9 rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-[#333]"
              >
                开始导入
              </button>
            </div>
          </div>
        )}

        {phase === 'importing' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#e5e5e5] border-t-black" />
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#999]">正在导入…</p>
          </div>
        )}

        {phase === 'done' && result && (
          <div className="space-y-4">
            <div className="rounded-md border border-[#e5e5e5] bg-[#fafafa] px-4 py-6 text-center">
              <p className="text-2xl font-semibold tracking-tight text-black">{result.created}</p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[#999]">
                条书签已导入
              </p>
              {result.skipped > 0 && (
                <p className="mt-2 font-mono text-[11px] text-[#999]">
                  跳过 {result.skipped} 条无效记录
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-[#333]"
              >
                完成
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

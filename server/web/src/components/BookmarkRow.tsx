import type { Bookmark } from '../types'
import { fullDate, hostOf, initialOf, timeAgo } from '../lib/format'

interface Props {
  bookmark: Bookmark
  inTrash: boolean
  onEdit: (b: Bookmark) => void
  onDelete: (b: Bookmark) => void
  onRestore: (b: Bookmark) => void
  onCopy: (url: string) => void
}

export function BookmarkRow({ bookmark: b, inTrash, onEdit, onDelete, onRestore, onCopy }: Props) {
  return (
    <li className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-[#fafafa]">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-black font-mono text-xs text-white">
        {initialOf(b.title, b.url)}
      </div>

      <div className="min-w-0 flex-1">
        <a
          href={b.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm font-medium text-black hover:underline"
          title={b.title || b.url}
        >
          {b.title || hostOf(b.url)}
        </a>
        <p className="truncate font-mono text-xs text-[#888]">
          {hostOf(b.url)}
          {b.folder && <span className="text-[#bbb]"> · {b.folder}</span>}
        </p>
      </div>

      {b.tags.length > 0 && (
        <div className="hidden shrink-0 gap-1 md:flex">
          {b.tags.slice(0, 3).map((t) => (
            <span
              key={t}
              className="rounded border border-[#e5e5e5] bg-[#fafafa] px-1.5 py-0.5 font-mono text-[10px] text-[#666]"
            >
              {t}
            </span>
          ))}
          {b.tags.length > 3 && (
            <span className="font-mono text-[10px] text-[#999]">+{b.tags.length - 3}</span>
          )}
        </div>
      )}

      <span
        className="hidden w-16 shrink-0 text-right font-mono text-[11px] text-[#999] sm:block"
        title={fullDate(b.updated_at)}
      >
        {timeAgo(b.updated_at)}
      </span>

      <div className="flex shrink-0 items-center gap-3 font-mono text-[11px] uppercase tracking-wide text-[#999] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button onClick={() => window.open(b.url, '_blank', 'noopener')} className="hover:text-black">
          打开
        </button>
        <button onClick={() => onCopy(b.url)} className="hover:text-black">
          复制
        </button>
        {inTrash ? (
          <button onClick={() => onRestore(b)} className="hover:text-black">
            恢复
          </button>
        ) : (
          <>
            <button onClick={() => onEdit(b)} className="hover:text-black">
              编辑
            </button>
            <button onClick={() => onDelete(b)} className="hover:text-red-600">
              删除
            </button>
          </>
        )}
      </div>
    </li>
  )
}

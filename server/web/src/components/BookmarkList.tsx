import type { Bookmark } from '../types'
import type { View } from '../Console'
import { BookmarkRow } from './BookmarkRow'

interface Props {
  bookmarks: Bookmark[]
  view: View
  onEdit: (b: Bookmark) => void
  onDelete: (b: Bookmark) => void
  onRestore: (b: Bookmark) => void
  onCopy: (url: string) => void
}

export function BookmarkList({ bookmarks, view, onEdit, onDelete, onRestore, onCopy }: Props) {
  if (bookmarks.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-[#d4d4d4] px-6 py-20 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-[#999]">
          {view === 'trash' ? '回收站为空' : '还没有书签'}
        </p>
        {view === 'all' && (
          <p className="mt-2 text-sm text-[#666]">
            点击「新建书签」创建第一个 — 之后可按{' '}
            <kbd className="rounded border border-[#d4d4d4] px-1 font-mono text-[11px]">/</kbd>{' '}
            键快速搜索。
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-[#e5e5e5] bg-white">
      <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[#999]">
          {bookmarks.length} 条书签
        </p>
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[#999]">
          按修改时间排序
        </p>
      </div>
      <ul className="divide-y divide-[#e5e5e5]">
        {bookmarks.map((b) => (
          <BookmarkRow
            key={b.id}
            bookmark={b}
            inTrash={view === 'trash'}
            onEdit={onEdit}
            onDelete={onDelete}
            onRestore={onRestore}
            onCopy={onCopy}
          />
        ))}
      </ul>
    </div>
  )
}

import type { RefObject } from 'react'

interface Props {
  q: string
  onQChange: (q: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  onNew: () => void
  onImport: () => void
}

export function Toolbar({ q, onQChange, searchRef, onNew, onImport }: Props) {
  return (
    <div className="border-b border-[#e5e5e5] px-8 py-4">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-[#999]">
            /
          </span>
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            placeholder="搜索标题、网址、备注、标签…"
            spellCheck={false}
            className="h-10 w-full rounded-md border border-[#d4d4d4] bg-white pl-7 pr-3 font-mono text-sm placeholder:text-[#bbb] focus:border-black focus:outline-none focus:ring-2 focus:ring-[#e5e5e5]"
          />
        </div>
        <button
          onClick={onImport}
          className="h-10 shrink-0 rounded-md border border-[#d4d4d4] px-4 text-sm text-[#444] transition-colors hover:border-black hover:text-black"
        >
          导入
        </button>
        <button
          onClick={onNew}
          className="h-10 shrink-0 rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-[#333]"
        >
          新建书签
        </button>
      </div>
    </div>
  )
}

import type { RefObject } from 'react'

interface Props {
  q: string
  onQChange: (q: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  onNew: () => void
  onImport: () => void
  /** 移动端唤出侧边栏抽屉；仅 < md 时展示汉堡按钮 */
  onMenu?: () => void
}

export function Toolbar({ q, onQChange, searchRef, onNew, onImport, onMenu }: Props) {
  return (
    <div className="border-b border-[#e5e5e5] px-4 py-3 md:px-8 md:py-4">
      <div className="mx-auto flex max-w-3xl items-center gap-2 md:gap-3">
        {onMenu && (
          <button
            onClick={onMenu}
            aria-label="打开菜单"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[#d4d4d4] text-[#444] transition-colors hover:border-black hover:text-black md:hidden"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M2 4h12M2 8h12M2 12h12" />
            </svg>
          </button>
        )}
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 hidden -translate-y-1/2 font-mono text-xs text-[#999] md:block">
            /
          </span>
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            placeholder="搜索标题、网址、备注、标签…"
            spellCheck={false}
            className="h-10 w-full rounded-md border border-[#d4d4d4] bg-white pl-3.5 pr-3 font-mono text-sm placeholder:text-[#bbb] focus:border-black focus:outline-none focus:ring-2 focus:ring-[#e5e5e5] md:pl-7"
          />
        </div>
        <button
          onClick={onImport}
          className="hidden h-10 shrink-0 rounded-md border border-[#d4d4d4] px-4 text-sm text-[#444] transition-colors hover:border-black hover:text-black md:block"
        >
          导入
        </button>
        <button
          onClick={onNew}
          className="h-10 shrink-0 rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-[#333]"
        >
          新建<span className="hidden sm:inline">书签</span>
        </button>
      </div>
    </div>
  )
}

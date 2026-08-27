import { useMemo, useState, type ReactNode } from 'react'
import type { FolderInfo } from '../types'
import type { View } from '../Console'

/* ---------------- 文件夹树 ---------------- */

interface FolderNode {
  name: string // 完整路径，如 "工作/项目A"
  label: string // 最后一段
  own: number // 精确匹配该书签数
  count: number // 含子文件夹的合计
  children: FolderNode[]
}

function buildTree(infos: FolderInfo[]): FolderNode[] {
  const map = new Map<string, FolderNode>()
  for (const f of infos) {
    const label = f.name.split('/').pop() || f.name
    map.set(f.name, { name: f.name, label, own: f.count, count: f.count, children: [] })
  }
  const roots: FolderNode[] = []
  for (const n of map.values()) {
    const i = n.name.lastIndexOf('/')
    const parent = i === -1 ? undefined : map.get(n.name.slice(0, i))
    if (parent) parent.children.push(n)
    else roots.push(n)
  }
  // 后序遍历累加子树计数（每个节点只算一次）
  const accumulate = (n: FolderNode): void => {
    for (const c of n.children) accumulate(c)
    n.count = n.own + n.children.reduce((s, c) => s + c.count, 0)
  }
  for (const r of roots) accumulate(r)
  const sortRec = (ns: FolderNode[]): void => {
    ns.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
    for (const n of ns) sortRec(n.children)
  }
  sortRec(roots)
  return roots
}

type Inline =
  | { mode: 'new'; parent?: string } // parent 缺省表示根级新建
  | { mode: 'rename'; path: string }

/* ---------------- 基础组件 ---------------- */

interface NavItemProps {
  active: boolean
  onClick: () => void
  label: string
  count?: number
  indent?: boolean
}

function NavItem({ active, onClick, label, count, indent }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-[15px] transition-colors ${
        active ? 'bg-black text-white' : 'text-[#444] hover:bg-[#eee] hover:text-black'
      } ${indent ? 'pl-6' : ''}`}
    >
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span
          className={`font-mono text-xs ${active ? 'text-white/60' : 'text-[#999] group-hover:text-[#666]'}`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#999]">
      {children}
    </p>
  )
}

interface InlineInputProps {
  initial?: string
  placeholder: string
  onCommit: (value: string) => void
  onCancel: () => void
}

/** 行内新建 / 重命名输入框：回车提交，Esc 或失焦取消。 */
function InlineInput({ initial, placeholder, onCommit, onCancel }: InlineInputProps) {
  const [value, setValue] = useState(initial ?? '')
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const t = value.trim()
          if (t) onCommit(t)
        } else if (e.key === 'Escape') {
          onCancel()
        }
      }}
      onBlur={onCancel}
      placeholder={placeholder}
      spellCheck={false}
      className="mx-3 my-1 h-8 w-[calc(100%-1.5rem)] rounded border border-[#d4d4d4] bg-white px-2 font-mono text-sm placeholder:text-[#bbb] focus:border-black focus:outline-none"
    />
  )
}

/* ---------------- 主组件 ---------------- */

interface Props {
  view: View
  onViewChange: (v: View) => void
  folder: string | null // null = 不过滤，'' = 未分类
  tag: string | null
  onFolderChange: (f: string | null) => void
  onTagChange: (t: string | null) => void
  folderInfos: FolderInfo[]
  tags: [string, number][]
  allCount: number
  trashCount: number
  untaggedCount: number
  server: string
  onDisconnect: () => void
  onCreateFolder: (name: string) => Promise<void>
  onRenameFolder: (oldName: string, newName: string) => Promise<void>
  onDeleteFolder: (name: string) => Promise<void>
  /** 移动端抽屉开关：桌面端（md:）始终常驻，忽略此值 */
  mobileOpen: boolean
}

export function Sidebar({
  view,
  onViewChange,
  folder,
  tag,
  onFolderChange,
  onTagChange,
  folderInfos,
  tags,
  allCount,
  trashCount,
  untaggedCount,
  server,
  onDisconnect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  mobileOpen,
}: Props) {
  const tree = useMemo(() => buildTree(folderInfos), [folderInfos])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [inline, setInline] = useState<Inline | null>(null)

  const toggle = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const expand = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(name)
      return next
    })

  const selectFolder = (name: string) => {
    onViewChange('all')
    onFolderChange(folder === name ? null : name)
  }

  const renderNodes = (nodes: FolderNode[], depth: number): ReactNode =>
    nodes.map((n) => {
      const active = view === 'all' && folder === n.name
      const isCollapsed = collapsed.has(n.name)
      return (
        <div key={n.name}>
          <div
            className={`group flex items-center gap-2 rounded-md py-1 pr-2 text-[15px] transition-colors ${
              active ? 'bg-black text-white' : 'text-[#444] hover:bg-[#eee] hover:text-black'
            }`}
            style={{ paddingLeft: depth * 16 + 6 }}
          >
            <button
              onClick={() => toggle(n.name)}
              className="w-5 shrink-0 text-center font-mono text-xs opacity-60 transition-transform hover:opacity-100"
              title={isCollapsed ? '展开' : '折叠'}
            >
              {n.children.length > 0 ? (isCollapsed ? '▸' : '▾') : ''}
            </button>
            <button
              onClick={() => selectFolder(n.name)}
              className="min-w-0 flex-1 truncate text-left"
              title={n.name}
            >
              {n.label}
            </button>
            <span className="shrink-0 font-mono text-xs opacity-60">{n.count}</span>
            <div className="flex shrink-0 gap-1 font-mono text-[13px] opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
              <button
                title="新建子文件夹"
                onClick={() => {
                  expand(n.name)
                  setInline({ mode: 'new', parent: n.name })
                }}
                className={`px-1.5 ${active ? 'hover:text-white/70' : 'hover:text-black'}`}
              >
                ＋
              </button>
              <button
                title="重命名"
                onClick={() => setInline({ mode: 'rename', path: n.name })}
                className={`px-1.5 ${active ? 'hover:text-white/70' : 'hover:text-black'}`}
              >
                ✎
              </button>
              <button
                title="删除"
                onClick={() => {
                  if (window.confirm(`删除文件夹「${n.name}」？其中的书签将变为未分类。`)) {
                    void onDeleteFolder(n.name).then(() => setInline(null))
                  }
                }}
                className={active ? 'px-1.5 hover:text-red-400' : 'px-1.5 hover:text-red-600'}
              >
                ✕
              </button>
            </div>
          </div>

          {!isCollapsed && renderNodes(n.children, depth + 1)}

          {inline?.mode === 'rename' && inline.path === n.name && (
            <InlineInput
              initial={n.label}
              placeholder="新名称"
              onCommit={(v) => {
                void onRenameFolder(n.name, v).then(() => setInline(null))
              }}
              onCancel={() => setInline(null)}
            />
          )}
          {inline?.mode === 'new' && inline.parent === n.name && (
            <InlineInput
              placeholder="子文件夹名称"
              onCommit={(v) => {
                void onCreateFolder(`${n.name}/${v}`).then(() => setInline(null))
              }}
              onCancel={() => setInline(null)}
            />
          )}
        </div>
      )
    })

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] shrink-0 flex-col border-r border-[#e5e5e5] bg-[#fafafa] shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${
        mobileOpen ? 'translate-x-0' : 'pointer-events-none -translate-x-full'
      } md:static md:z-auto md:w-60 md:max-w-none md:translate-x-0 md:shadow-none md:transition-none`}
    >
      <div className="flex items-center gap-2 px-4 pb-4 pt-5">
        <div className="flex h-7 w-7 items-center justify-center bg-black font-mono text-sm font-semibold text-white">
          m
        </div>
        <span className="font-mono text-lg font-semibold tracking-tight">markmax</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <SectionLabel>书库</SectionLabel>
        <div className="space-y-0.5">
          <NavItem
            active={view === 'all' && folder === null && !tag}
            onClick={() => onViewChange('all')}
            label="全部书签"
            count={allCount}
          />
          <NavItem
            active={view === 'all' && folder === '' && !tag}
            onClick={() => {
              onViewChange('all')
              onFolderChange(folder === '' ? null : '')
            }}
            label="未分类"
            count={untaggedCount}
          />
          <NavItem active={view === 'trash'} onClick={() => onViewChange('trash')} label="回收站" count={trashCount} />
        </div>

        {(tree.length > 0 || inline?.mode === 'new' && inline.parent === undefined) && (
          <>
            <div className="flex items-center justify-between pr-2">
              <SectionLabel>文件夹</SectionLabel>
              <button
                onClick={() => setInline({ mode: 'new' })}
                className="font-mono text-xs text-[#999] hover:text-black"
                title="新建文件夹"
              >
                ＋
              </button>
            </div>
            <div className="space-y-0.5">
              {renderNodes(tree, 0)}
              {inline?.mode === 'new' && inline.parent === undefined && (
                <InlineInput
                  placeholder="文件夹名称（可用 / 分级）"
                  onCommit={(v) => {
                    void onCreateFolder(v).then(() => setInline(null))
                  }}
                  onCancel={() => setInline(null)}
                />
              )}
            </div>
          </>
        )}

        {tags.length > 0 && (
          <>
            <SectionLabel>标签</SectionLabel>
            <div className="space-y-0.5">
              {tags.map(([name, count]) => (
                <NavItem
                  key={name}
                  active={view === 'all' && tag === name}
                  onClick={() => {
                    onViewChange('all')
                    onTagChange(tag === name ? null : name)
                  }}
                  label={name}
                  count={count}
                  indent
                />
              ))}
            </div>
          </>
        )}
      </nav>

      <div className="border-t border-[#e5e5e5] px-4 py-3">
        <p className="truncate font-mono text-[10px] text-[#999]" title={server}>
          {server}
        </p>
        <button
          onClick={onDisconnect}
          className="mt-2 w-full rounded-md border border-[#d4d4d4] bg-white py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#666] transition-colors hover:border-black hover:text-black"
        >
          断开连接
        </button>
      </div>
    </aside>
  )
}

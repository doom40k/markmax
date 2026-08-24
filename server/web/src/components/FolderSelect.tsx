import { Combobox } from '@headlessui/react'
import { useMemo, useState } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  /** 全部文件夹名（含层级路径，如 "工作/项目A"） */
  folders: string[]
  placeholder?: string
}

const inputCls =
  'h-10 w-full cursor-text rounded-md border border-[#d4d4d4] bg-white pl-3 pr-8 text-sm text-black placeholder:text-[#bbb] focus:border-black focus:outline-none focus:ring-2 focus:ring-[#e5e5e5]'

/** 文件夹选择器：可搜索、可从列表选择、也可直接输入新名字（保存时自动登记）。 */
export function FolderSelect({
  value,
  onChange,
  folders,
  placeholder = '选择或输入文件夹',
}: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return folders
    return folders.filter((f) => f.toLowerCase().includes(q))
  }, [folders, query])

  const input = query.trim()
  const showCreate = input !== '' && !folders.includes(input)

  /** 层级路径展示：父级灰色小字 + 末段正文 */
  function renderPath(name: string) {
    const parts = name.split('/')
    const last = parts[parts.length - 1]
    const parent = parts.slice(0, -1).join('/')
    return (
      <span className="flex min-w-0 items-baseline gap-1.5">
        {parent && (
          <span className="truncate font-mono text-[11px] text-[#999]">{parent}/</span>
        )}
        <span className="truncate">{last}</span>
      </span>
    )
  }

  return (
    <Combobox
      value={value}
      onChange={(v) => {
        onChange(v)
        setQuery('')
      }}
    >
      <div className="relative">
        <Combobox.Input
          value={value}
          onChange={(e) => {
            setQuery(e.target.value)
            onChange(e.target.value)
          }}
          onKeyDown={(e) => {
            // 面板内 Esc 只关下拉，不关整个弹窗
            if (e.key === 'Escape') e.stopPropagation()
          }}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className={inputCls}
        />
        <Combobox.Button className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] text-[#999] transition-colors hover:text-black">
          ▾
        </Combobox.Button>

        <Combobox.Options className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-[#e5e5e5] bg-white py-1 shadow-lg focus:outline-none">
          {filtered.map((name) => (
            <Combobox.Option
              key={name}
              value={name}
              className={({ focus }) =>
                `flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-[15px] ${
                  focus ? 'bg-[#f5f5f5] text-black' : 'text-[#444]'
                }`
              }
            >
              {({ selected }) => (
                <>
                  <span className="min-w-0 flex-1">{renderPath(name)}</span>
                  {selected && <span className="font-mono text-xs text-black">✓</span>}
                </>
              )}
            </Combobox.Option>
          ))}

          {showCreate && (
            <Combobox.Option
              value={input}
              className={({ focus }) =>
                `flex cursor-pointer items-center gap-2 border-t border-dashed border-[#e5e5e5] px-3 py-1.5 text-[15px] ${
                  focus ? 'bg-[#f5f5f5] text-black' : 'text-[#666]'
                }`
              }
            >
              ＋ 新建文件夹「{input}」
            </Combobox.Option>
          )}

          {filtered.length === 0 && !showCreate && (
            <div className="px-3 py-2 font-mono text-xs text-[#999]">没有匹配的文件夹</div>
          )}
        </Combobox.Options>
      </div>
    </Combobox>
  )
}

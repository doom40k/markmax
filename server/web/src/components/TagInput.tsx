import { useRef, useState } from 'react'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

/** 标签输入器：chips 展示 + 输入框；回车/逗号添加，退格删除末位，支持一次粘贴多个（逗号分隔）。 */
export function TagInput({
  value,
  onChange,
  placeholder = '输入后回车添加',
}: Props) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const add = (raw: string) => {
    const items = raw
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (items.length === 0) return
    const next = [...value]
    for (const item of items) {
      if (!next.includes(item)) next.push(item)
    }
    onChange(next)
  }

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag))

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-[#d4d4d4] bg-white px-2.5 py-1.5 transition-colors focus-within:border-black focus-within:ring-2 focus-within:ring-[#e5e5e5]"
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded bg-[#f5f5f5] px-2 py-0.5 text-[13px] text-[#444] ring-1 ring-[#e5e5e5]"
        >
          {tag}
          <button
            type="button"
            title="移除标签"
            onClick={(e) => {
              e.stopPropagation()
              remove(tag)
            }}
            className="font-mono text-[11px] leading-none text-[#999] transition-colors hover:text-red-600"
          >
            ✕
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add(draft)
            setDraft('')
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            remove(value[value.length - 1])
          }
        }}
        onBlur={() => {
          add(draft)
          setDraft('')
        }}
        placeholder={value.length === 0 ? placeholder : ''}
        spellCheck={false}
        className="min-w-24 flex-1 border-0 bg-transparent py-0.5 text-sm text-black outline-none placeholder:text-[#bbb]"
      />
    </div>
  )
}

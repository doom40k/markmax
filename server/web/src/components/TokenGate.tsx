import { useState, type FormEvent } from 'react'

interface Props {
  onConnect: (base: string, token: string) => void
  initialBase?: string
  initialToken?: string
  error?: string | null
}

const inputCls =
  'h-10 w-full rounded-md border border-[#d4d4d4] bg-white px-3 font-mono text-sm text-black placeholder:text-[#bbb] focus:border-black focus:outline-none focus:ring-2 focus:ring-[#e5e5e5]'

export function TokenGate({ onConnect, initialBase, initialToken, error }: Props) {
  const [base, setBase] = useState(initialBase ?? 'http://localhost:8080')
  const [token, setToken] = useState(initialToken ?? '')

  function submit(e: FormEvent) {
    e.preventDefault()
    const b = base.trim()
    const t = token.trim()
    if (!b || !t) return
    onConnect(b, t)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center bg-black font-mono text-lg font-semibold text-white">
            m
          </div>
          <div>
            <h1 className="text-center font-mono text-xl font-semibold tracking-tight">Markmax</h1>
            <p className="mt-1 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-[#999]">
              服务器控制台
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.12em] text-[#666]">
              服务器地址
            </label>
            <input
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="http://localhost:8080"
              spellCheck={false}
              autoComplete="off"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.12em] text-[#666]">
              API 令牌
            </label>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="粘贴服务端日志中的 token"
              spellCheck={false}
              autoComplete="off"
              type="password"
              className={inputCls}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            className="h-10 w-full rounded-md bg-black font-medium text-white transition-colors hover:bg-[#333]"
          >
            连接
          </button>
        </form>

        <p className="mt-8 text-center font-mono text-[11px] leading-relaxed text-[#aaa]">
          token 会在服务端首次启动时打印在日志中，
          <br />
          也可在 <span className="text-[#666]">data/token</span> 文件中查看。
        </p>
      </div>
    </div>
  )
}

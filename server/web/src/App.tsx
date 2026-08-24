import { useCallback, useEffect, useState } from 'react'
import { AuthError, createApi, type Api, type Session } from './api'
import { Console } from './Console'
import { TokenGate } from './components/TokenGate'

const SESSION_KEY = 'markmax.session'

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Session
    if (!s.base || !s.token) return null
    return s
  } catch {
    return null
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [api, setApi] = useState<Api | null>(null)
  const [booting, setBooting] = useState(false)
  const [gateError, setGateError] = useState<string | null>(null)
  const [lastBase, setLastBase] = useState<string | null>(null)

  useEffect(() => {
    if (!session) {
      setApi(null)
      return
    }
    setBooting(true)
    const client = createApi(session)
    client
      .health()
      .then(() => {
        setApi(client)
        setGateError(null)
      })
      .catch((err) => {
        // 会话失效：清掉并让用户在登录页重试
        localStorage.removeItem(SESSION_KEY)
        setSession(null)
        setLastBase(session.base)
        setGateError(
          err instanceof AuthError
            ? '服务器拒绝了该 token。'
            : `无法连接 ${session.base}，请确认服务已启动。`,
        )
      })
      .finally(() => setBooting(false))
  }, [session])

  const connect = useCallback((base: string, token: string) => {
    const next: Session = { base: base.replace(/\/+$/, ''), token: token.trim() }
    localStorage.setItem(SESSION_KEY, JSON.stringify(next))
    setSession(next)
  }, [])

  const disconnect = useCallback(() => {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
  }, [])

  if (booting && !api) {
    return <BootScreen />
  }
  if (!session || !api) {
    return (
      <TokenGate
        onConnect={connect}
        initialBase={lastBase ?? session?.base}
        initialToken={session?.token}
        error={gateError}
      />
    )
  }
  return <Console api={api} onDisconnect={disconnect} />
}

function BootScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-white">
      <p className="animate-pulse font-mono text-xs uppercase tracking-[0.3em] text-[#999]">
        markmax · 连接中…
      </p>
    </div>
  )
}

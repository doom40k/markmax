export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 10) return '刚刚'
  if (s < 60) return `${s} 秒前`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} 天前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function fullDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
}

/** 取标题首字母；标题为空时回退到域名首字符。 */
export function initialOf(title: string, url: string): string {
  const t = title.trim()
  if (t) return t[0].toUpperCase()
  const u = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  return (u[0] || '·').toUpperCase()
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

import type { ImportItem } from '../types'

export interface ParseResult {
  items: ImportItem[]
  folders: string[]
}

/**
 * 解析 Chrome / Raindrop 导出的书签 HTML（Netscape 格式）。
 *
 * 结构约定：
 * - <DL> 为文件夹容器，<DT> 包裹子项
 * - <DT><A HREF="..." ADD_DATE="..." [TAGS="a,b"]>标题</A> 为书签
 * - <DT><H3>文件夹名</H3><DL>…</DL> 为文件夹（可嵌套）
 * - Raindrop / Firefox 用 TAGS 属性携带标签；Chrome 无标签
 */
export function parseBookmarkHtml(source: string): ParseResult {
  const doc = new DOMParser().parseFromString(source, 'text/html')
  const rootDl = doc.querySelector('dl')
  if (!rootDl) {
    throw new Error('无法识别书签文件：缺少 <DL> 结构，请选择 Chrome / Raindrop 导出的书签 HTML。')
  }

  const items: ImportItem[] = []
  const folders = new Set<string>()

  /** dt 是否属于当前 dl（兼容 `<dl><p><dt>` 中 dt 被解析进 p 的情况） */
  const belongsTo = (dt: Element, dl: Element): boolean =>
    dt.parentElement?.closest('dl') === dl

  const walk = (dl: Element, folderPath: string): void => {
    for (const dt of Array.from(dl.querySelectorAll('dt'))) {
      if (!belongsTo(dt, dl)) continue // 属于更内层 dl 的 dt 由递归处理

      // 书签
      const a = dt.querySelector(':scope > a')
      if (a) {
        const href = (a.getAttribute('href') ?? '').trim()
        if (!href || /^(javascript|data|about):/i.test(href)) continue
        const rawTags = a.getAttribute('tags') ?? a.getAttribute('keywords') ?? ''
        const tags = [...new Set(rawTags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean))]
        const item: ImportItem = {
          title: (a.textContent ?? '').trim(),
          url: href,
          tags,
          folder: folderPath,
        }
        const addDate = Number(a.getAttribute('add_date'))
        if (Number.isFinite(addDate) && addDate > 0) {
          item.created_at = addDate * 1000 // 秒 → 毫秒
        }
        items.push(item)
        continue
      }

      // 文件夹：<H3> 名字 + 内层 <DL>
      const h3 = dt.querySelector(':scope > h3')
      const innerDl = dt.querySelector(':scope > dl')
      if (h3 && innerDl) {
        const name = (h3.textContent ?? '').trim()
        if (name) {
          const next = folderPath ? `${folderPath}/${name}` : name
          folders.add(next)
          walk(innerDl, next)
        }
      }
    }
  }

  walk(rootDl, '')
  return { items, folders: [...folders].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')) }
}

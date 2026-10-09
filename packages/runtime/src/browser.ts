
import type { DirectiveKind, DirectivePayload, HeadEntry } from './types'

export function emitDirective(kind: 'head', entries: HeadEntry[]): void
export function emitDirective(kind: 'status', status: { code: number }): void
export function emitDirective(kind: DirectiveKind, payload: DirectivePayload): void {
  if (typeof window === 'undefined') {
    const host = globalThis.__ploykit_host__
    if (!host) {
      throw new Error(
        '[ploykit/runtime] 服务端渲染态缺少 __ploykit_host__ 指令宿主（指令应经 createSsrEntry 渲染发射）',
      )
    }
    host.directive(kind, JSON.stringify(payload))
    return
  }
  if (kind === 'head') upsertHeadEntries(payload as HeadEntry[])
  // 'status' 在浏览器端无意义（v1 仅服务端记录日志），静默忽略。
}



function upsertHeadEntries(entries: HeadEntry[]): void {
  for (const entry of entries) {
    if (entry.tag === 'title') {
      
      document.title = entry.children ?? ''
      continue
    }
    if (entry.tag === 'meta' && keyedUpsertMeta(entry)) continue
    upsertOther(entry)
  }
}


function keyedUpsertMeta(entry: HeadEntry): boolean {
  const attrs = entry.attrs ?? {}
  const keyAttr = 'name' in attrs ? 'name' : 'property' in attrs ? 'property' : null
  if (!keyAttr) return false
  const wanted = attrs[keyAttr]
  const metas = document.head.getElementsByTagName('meta')
  for (let i = 0; i < metas.length; i++) {
    if (metas[i].getAttribute(keyAttr) === wanted) {
      for (const [k, v] of Object.entries(attrs)) metas[i].setAttribute(k, v)
      return true
    }
  }
  const el = document.createElement('meta')
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.head.appendChild(el)
  return true
}


function upsertOther(entry: HeadEntry): void {
  const attrs = entry.attrs ?? {}
  const exists = Array.from(document.head.children).some(
    (el) =>
      el.tagName.toLowerCase() === entry.tag &&
      Object.entries(attrs).every(([k, v]) => el.getAttribute(k) === v),
  )
  if (exists) return
  const el = document.createElement(entry.tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  if (entry.children !== undefined) el.textContent = entry.children
  document.head.appendChild(el)
}

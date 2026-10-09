
import type { ReactElement } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import type { RouteTable } from './routes'


export const PROPS_SCRIPT_ID = '__PLOYKIT_PROPS__'


export function serializeProps(props: unknown): string {
  return JSON.stringify(props ?? null).replace(/</g, '\\u003c')
}

export interface HydratePayload {
  pageId: string
  props: unknown
}


export function readPropsScript(doc: Document = document): HydratePayload | null {
  const el = doc.getElementById(PROPS_SCRIPT_ID)
  if (!el || !el.textContent) return null
  const pageId = el.getAttribute('data-page-id')
  if (!pageId) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(el.textContent)
  } catch (err) {
    
    
    
    
    
    
    console.error('[ploykit/runtime] props script JSON 解析失败，回退 SPA 挂载', err)
    return null
  }
  
  
  
  
  return { pageId, props: parsed ?? undefined }
}

export interface ClientEntryOptions {
  
  routes: RouteTable
  
  mount: (children: ReactElement) => ReactElement
  
  container?: HTMLElement | null
}

export function createClientEntry({ routes: table, mount, container }: ClientEntryOptions): void {
  const rootEl = container ?? document.getElementById('root')
  if (!rootEl) throw new Error('[ploykit/runtime] 未找到挂载点 #root')
  const hydrated = readPropsScript()
  if (hydrated) {
    
    hydrateRoot(rootEl, mount(table.routes({ [hydrated.pageId]: hydrated.props })))
    return
  }
  
  createRoot(rootEl).render(mount(table.routes()))
}

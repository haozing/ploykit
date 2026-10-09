
import { emitDirective, type HeadEntry } from '@ploykit/runtime'

export interface SeoMeta {
  title?: string
  description?: string
  ogImage?: string
}

export function useSEO(meta: SeoMeta): void {
  const entries: HeadEntry[] = []
  if (meta.title) entries.push({ tag: 'title', children: meta.title })
  if (meta.description) {
    entries.push({ tag: 'meta', attrs: { name: 'description', content: meta.description } })
  }
  if (meta.ogImage) {
    entries.push({ tag: 'meta', attrs: { property: 'og:image', content: meta.ogImage } })
    
    entries.push({ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } })
  }
  emitDirective('head', entries)
}

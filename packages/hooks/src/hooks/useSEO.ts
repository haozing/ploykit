
import { emitDirective, type HeadEntry } from '@ploykit/runtime'

export interface SeoMeta {
  title?: string
  description?: string
  ogImage?: string
  /** Absolute or root-relative URL for <link rel="canonical">. The runtime
   * keeps canonical a singleton: SPA navigation updates it in place. The
   * value is sticky — a page that emits no canonical inherits the previous
   * one, so pages that must not carry one should declare their own. */
  canonical?: string
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
  if (meta.canonical) {
    entries.push({ tag: 'link', attrs: { rel: 'canonical', href: meta.canonical } })
  }
  emitDirective('head', entries)
}

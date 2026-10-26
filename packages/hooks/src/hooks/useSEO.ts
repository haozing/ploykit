
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
  /** og:title. Defaults to `title` — a page that declares a title gets a
   * complete OG card with zero extra config (field report #22: useSEO never
   * emitted the og essentials, so social/AI scrapers saw no card text and
   * every consumer invented a side-channel hook). Pass an explicit value for
   * a social-optimized variant shorter than the document title. */
  ogTitle?: string
  /** og:description. Defaults to `description`. */
  ogDescription?: string
  /** og:url. Defaults to `canonical`. Scrapers prefer absolute URLs here —
   * pass this explicitly when the canonical is root-relative. */
  ogUrl?: string
  /** og:type. Defaults to 'website'; article pages pass 'article'. */
  ogType?: string
  /** twitter:site @handle (product-level, e.g. '@yourbrand'). X mirrors
   * twitter:title/description/image from the og values automatically;
   * twitter:site has no og counterpart, so it is opt-in here. */
  twitterSite?: string
  /** og:site_name. Human-readable name of the site as a whole (product-level
   * constant, e.g. 'MyProduct') — how shared cards attribute the page. */
  ogSiteName?: string
  /** og:locale in ll_CC format (language_TERRITORY, e.g. 'zh_CN', 'en_US').
   * Emitted only when passed; scrapers default to en_US when absent. */
  ogLocale?: string
  /** og:image:alt — text describing the OG image (screen readers and
   * scrapers that cannot load the image). Only emitted when ogImage is
   * present: an alt without an image is a meaningless dangling tag. */
  ogImageAlt?: string
  /** og:image:width in pixels (number). Only emitted when ogImage is present.
   * Some scrapers (WeChat/WhatsApp) refuse to render card images without an
   * explicit size. */
  ogImageWidth?: number
  /** og:image:height in pixels (number). Only emitted when ogImage is
   * present; pass it together with ogImageWidth. */
  ogImageHeight?: number
}

/**
 * Emits page SEO meta as head directives through @ploykit/runtime (renderx
 * prerenders them; SPA navigation updates them in place).
 *
 * Boundary: ogImageAlt / ogImageWidth / ogImageHeight describe a caller-owned
 * OG image asset — the example app ships no OG image assets, so it does not
 * wire these fields; they exist for products that do. The og:image URL itself
 * is passed through untouched (server-side absolutization is renderx's job).
 */
export function useSEO(meta: SeoMeta): void {
  const entries: HeadEntry[] = []
  if (meta.title) entries.push({ tag: 'title', children: meta.title })
  if (meta.description) {
    entries.push({ tag: 'meta', attrs: { name: 'description', content: meta.description } })
  }

  // OG essentials mirror what the page already declares (the industry default:
  // og:title <- title, og:description <- description, og:url <- canonical) with
  // explicit og* fields overriding the mirrors, so the card is complete without
  // per-page boilerplate. twitter:title/description/image mirror the og values
  // the same way (X falls back to the og tags when they are absent — emitting
  // them keeps the card semantics explicit; #22 second-round audit).
  // F-3 additions (site_name / locale / image sub-tags) are emitted when
  // present; site_name and locale also activate the og group on their own.
  const ogTitle = meta.ogTitle ?? meta.title
  const ogDescription = meta.ogDescription ?? meta.description
  const ogUrl = meta.ogUrl ?? meta.canonical
  const ogType = meta.ogType ?? 'website'
  if (meta.ogImage || ogTitle || ogDescription || ogUrl || meta.ogType || meta.ogSiteName || meta.ogLocale) {
    if (ogTitle) entries.push({ tag: 'meta', attrs: { property: 'og:title', content: ogTitle } })
    if (ogDescription) {
      entries.push({ tag: 'meta', attrs: { property: 'og:description', content: ogDescription } })
    }
    if (meta.ogImage) {
      entries.push({ tag: 'meta', attrs: { property: 'og:image', content: meta.ogImage } })
      // Image sub-tags qualify og:image itself, so they only make sense next
      // to one — an alt/dimension without an image is a dangling tag.
      if (meta.ogImageAlt) {
        entries.push({ tag: 'meta', attrs: { property: 'og:image:alt', content: meta.ogImageAlt } })
      }
      if (meta.ogImageWidth) {
        entries.push({ tag: 'meta', attrs: { property: 'og:image:width', content: String(meta.ogImageWidth) } })
      }
      if (meta.ogImageHeight) {
        entries.push({ tag: 'meta', attrs: { property: 'og:image:height', content: String(meta.ogImageHeight) } })
      }
    }
    if (ogUrl) entries.push({ tag: 'meta', attrs: { property: 'og:url', content: ogUrl } })
    if (meta.ogSiteName) {
      entries.push({ tag: 'meta', attrs: { property: 'og:site_name', content: meta.ogSiteName } })
    }
    if (meta.ogLocale) {
      entries.push({ tag: 'meta', attrs: { property: 'og:locale', content: meta.ogLocale } })
    }
    entries.push({ tag: 'meta', attrs: { property: 'og:type', content: ogType } })

    if (ogTitle) entries.push({ tag: 'meta', attrs: { name: 'twitter:title', content: ogTitle } })
    if (ogDescription) {
      entries.push({ tag: 'meta', attrs: { name: 'twitter:description', content: ogDescription } })
    }
    if (meta.ogImage) {
      entries.push({ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } })
      entries.push({ tag: 'meta', attrs: { name: 'twitter:image', content: meta.ogImage } })
    }
    if (meta.twitterSite) {
      entries.push({ tag: 'meta', attrs: { name: 'twitter:site', content: meta.twitterSite } })
    }
  }
  if (meta.canonical) {
    entries.push({ tag: 'link', attrs: { rel: 'canonical', href: meta.canonical } })
  }
  emitDirective('head', entries)
}

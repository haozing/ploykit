# renderx render pipeline SEO audit — document-assembly omissions (2026-10-26)

Source: 5-agent parallel SEO audit of the shuijing production site
(braceletmakeronline.com) + manual review. Trigger: the investigation of
site-wide favicon link loss revealed that RenderDocument **rebuilds** the
document instead of rewriting the Vite shell — nothing in the shell
(`web/index.html` / `dist/index.html`) is inherited, so anything a page does
not emit via head directives is simply absent. This doc collects the issues
**fixed in ploykit**; product-side issues live in shuijing
`docs/seo-render-audit-2026-10-26.md`.
Status: **fixed on master (2026-10-26 batch)** — F-1..F-5 landed with the
shell-head inheritance mechanism; the same mechanism also carries the
product-side S-1 (favicon) / S-5 (theme-color) root causes and the
example-side S-12 fallback switch. See CHANGELOG for the release notes.

## Issue list

### F-1 [P0] RenderDocument had no viewport fallback — FIXED

- Was: `platform/renderx/template.go` RenderDocument wrote only
  `<meta charset>` unconditionally; viewport depended entirely on per-page
  head directives. The shuijing site (production included) had none — the
  shell's `web/index.html:7` viewport was dropped.
- Impact: mobile rendered at a 980px desktop viewport scaled down;
  Google mobile-first indexing penalizes mobile usability. Any product that
  does not emit viewport per page hits this — a platform-level default gap.
- Fix: RenderDocument writes
  `<meta name="viewport" content="width=device-width, initial-scale=1">`
  right after charset unless the page (or inherited shell head) already
  declares `meta[name=viewport]` — pages can still override (e.g. an editor
  page's `user-scalable=no`).
- Acceptance: every prerendered page contains viewport; no duplicate output
  when the page emits its own. (Verified on example: 6/6 pages.)

### F-2 [P1] Relative og:image / twitter:image passed through — FIXED

- Was: `packages/hooks/src/hooks/useSEO.ts` passed ogImage through verbatim;
  SeoMeta had no site-root concept. shuijing shipped relative `/shots/*.jpg`
  on 7 pages — OG consumers (Facebook/LinkedIn/Telegram) drop relative URLs,
  so share cards had no image.
- Fix: absolutization lives in the Go layer (single point, works for
  prerender + SSR identically): `Document.BaseURL` (sourced from
  PUBLIC_BASE_URL, validated) rewrites relative `og:image` /
  `twitter:image` / `og:url` content values at RenderDocument time.
  Already-absolute values untouched; empty/invalid BaseURL = no-op;
  canonical deliberately untouched (relative canonical is legal); client-side
  head updates after SPA navigation keep page-emitted values (crawlers read
  the first HTML only — documented boundary).
- Acceptance: pages passing relative paths produce absolute og URLs in the
  served HTML when PUBLIC_BASE_URL is set. (Unit tests + example prerender
  run with the env set.)

### F-3 [P1] Missing OG enrichment baseline (site_name / og:image
dimensions+alt / og:locale) — FIXED

- Was: useSEO emitted only the essentials (title/description/og
  four-piece/twitter mirrors); no field existed for the enrichment.
- Fix: SeoMeta gains `ogSiteName`, `ogImageAlt`, `ogImageWidth`,
  `ogImageHeight`, `ogLocale` (ll_CC), emitted when present; the image
  dimension/alt tags emit only alongside an actual ogImage. Example wires
  ogSiteName/ogLocale on its public pages; og:image dimensions stay
  unwired by example (no OG image asset) — boundary declared in the
  useSEO JSDoc.
- Acceptance: configured sites emit a complete og card.

### F-4 [P1] modulepreload lost — FIXED

- Was: the Vite shell carried `<link rel="modulepreload">` for entry-static
  chunks; RenderDocument emitted none and the Document struct had no
  channel for them (shuijing: 2 links lost per page).
- Fix: modulepreload links are shell head entries — the shell-head
  inheritance mechanism (below) carries them, and they render before the
  stylesheets (preload scanner friendly). No separate Document field
  needed.
- Acceptance: prerendered pages carry the same modulepreload set as the
  shell. (Mechanism unit-tested; the example shell itself emits 0 today.)

### F-5 [P2] html/body attributes lost (background color → FOUC) — FIXED

- Was: the Vite shell had `<html style="background:#faf8f3">` etc.;
  RenderDocument hardcoded attribute-less tags.
- Fix: `Document.HTMLAttrs` / `BodyAttrs` (extracted from the shell's
  open tags, `lang` stripped — `Lang` owns it) render onto the tags through
  the same attribute whitelist.
- Acceptance: warm/dark-background sites no longer flash white.

## The mechanism behind F-4/F-5 + the product-side S-1/S-5 root causes

`renderx.ParseShellHead(shellHTML)` extracts the inheritable head tags
(link/meta minus stylesheet/charset/viewport/title) plus html/body open-tag
attributes; `ViteAssets.Shell` carries them through every document-assembly
path (runtime SSR handler, Service refresh, prerender, direct RenderOnce),
and RenderDocument emits them (viewport fallback → inherited → page head →
preloads → CSS), page entries winning on (tag, rel/name/property)
collisions. This is what restores favicon links and theme-color site-wide —
the product-side audit's S-1/S-5 items resolve at the root instead of
per-page components.

## Release & downstream

- Landed on master 2026-10-26; released after the v0.17.x line (see
  CHANGELOG).
- shuijing upgrade discipline: hooks must upgrade together with ui
  (historical dual-instance crash lesson).
- Product-side items depending on this doc: og:image absolutization (F-2),
  og enrichment (F-3); viewport/modulepreload/background are global fixes.

## Confirmed non-issues (do not re-audit)

- Snapshot consistency: the shuijing production site matched
  `cmd/app/frontend/prerender/*.html` byte for byte (plus one
  runtime-injected google-site-verification line).
- SSR is not an empty shell: #root carries full content; the MaxPropsBytes
  cap exists (props slimming is a product usage matter — product doc S-11).
- The denyTags/denyAttrs denylist was sound; the link/meta directive
  channel was usable (GeistFontPreload rode it).

// Production-shape regression: the client bundle is minified (vite -> esbuild
// identifier mangling), so routeTable derives pageIds from MANGLED component
// names while the SSR bundle (Go esbuild, no minify flags) keeps the original
// names. The props script therefore carries a pageId that does not exist in
// the client route table, and keying hydration props by it lost ALL page props
// (P0). The fix resolves the owning page by matching window.location.pathname
// against the client table's own route paths (string literals survive
// minification and are identical in both bundles).
//
// Everything here runs inside `act` so React's (asynchronous) hydration work
// is flushed before asserting: on a hydration mismatch React 19 recovers via a
// client re-render whose console.error and DOM replacement happen AFTER
// hydrateRoot returns, so asserting without act reads stale server markup and
// misses the bug.
import { Worker } from 'node:worker_threads'
import { act, createElement, type ComponentType, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, StaticRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { createClientEntry, PROPS_SCRIPT_ID, serializeProps } from '../hydrate'
import { routeTable } from '../routes'
import { matchRoutePage, reactRouterAssembler } from '../router-react-router'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// esbuild's JS API refuses to load under jsdom: the vitest jsdom realm breaks
// its `new TextEncoder().encode("") instanceof Uint8Array` identity invariant,
// checked at module load. Run the minification in a pristine Node worker
// thread instead — same esbuild package, same flags vite applies to
// production client builds.
const MINIFY_WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads')
const { transform } = require('esbuild')
transform(workerData.src, { minify: true, format: 'cjs' })
  .then((r) => parentPort.postMessage({ code: r.code }))
  .catch((err) => parentPort.postMessage({ error: String((err && err.message) || err) }))
`

function esbuildMinify(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = new Worker(MINIFY_WORKER_SRC, { eval: true, workerData: { src } })
    w.on('message', (msg: { code?: string; error?: string }) =>
      msg.error ? reject(new Error(msg.error)) : resolve(msg.code ?? ''),
    )
    w.on('error', reject)
  })
}

// The component records the marker it was rendered with into a global, so the
// test can assert on the props the component ACTUALLY received (DOM text alone
// can be stale server markup). Property names and globals survive esbuild
// minification, so the instrumentation stays intact in the minified output.
const MANGLED_SRC = `
function WorkPage(props) {
  const marker = props && props.marker ? props.marker : 'no-props'
  ;(globalThis.__seenMarkers = globalThis.__seenMarkers || []).push(marker)
  return React.createElement('p', { 'data-marker': marker }, marker)
}
globalThis.__minifiedWorkPage = WorkPage
export {}
`

async function minifiedWorkPage(): Promise<ComponentType<MarkerProps>> {
  // format: 'cjs' wraps the module into plain statements (an export statement
  // cannot appear inside new Function); the `module` free variable is injected
  // as an empty object.
  const code = await esbuildMinify(MANGLED_SRC)
  new Function('React', 'module', code)({ createElement }, {})
  const g = globalThis as unknown as {
    __minifiedWorkPage?: ComponentType<MarkerProps>
    __seenMarkers?: string[]
  }
  const comp = g.__minifiedWorkPage
  delete g.__minifiedWorkPage
  expect(comp).toBeDefined()
  // Pin the mechanism: minification really did destroy the component name —
  // the root cause of the production bug.
  expect(comp!.name).not.toBe('WorkPage')
  return comp!
}

function seenMarkers(): string[] {
  return ((globalThis as { __seenMarkers?: string[] }).__seenMarkers ?? [])
}

function resetSeenMarkers(): void {
  ;(globalThis as { __seenMarkers?: string[] }).__seenMarkers = []
}

interface MarkerProps {
  marker?: string
}

function LegacyPage(props: MarkerProps | undefined) {
  const marker = props?.marker ?? 'no-props'
  return <p data-marker={marker}>{marker}</p>
}

const PROPS: MarkerProps = { marker: 'from-ssr' }

function assemble(ssrHtml: string, pageId: string, propsJson: string): void {
  document.body.innerHTML = `<div id="root">${ssrHtml}</div>
<script type="application/json" id="${PROPS_SCRIPT_ID}" data-page-id="${pageId}">${propsJson}</script>`
}

function mountAt(pathname: string, basename?: string) {
  return (children: ReactElement): ReactElement =>
    createElement(
      MemoryRouter,
      basename ? { initialEntries: [pathname], basename } : { initialEntries: [pathname] },
      children,
    )
}

describe('hydration props resolution under a minified client bundle', () => {
  it('client pageId derives from the mangled name while the props script embeds the SSR pageId -> props delivered via pathname match', async () => {
    const comp = await minifiedWorkPage()
    const table = routeTable({ '/works/:slug': { component: comp, render: 'static' } }, reactRouterAssembler())
    // Pin the precondition: the client table's own pageId (derived from the
    // mangled name) disagrees with the SSR-embedded 'work-page' — exactly the
    // production setup that lost all props.
    expect(table.pages[0]?.pageId).not.toBe('work-page')

    // Server side (non-minified bundle): renders WITH props and embeds the
    // UNMINIFIED pageId in the props script — what Go renderx emits.
    const ssrHtml = renderToString(
      createElement(StaticRouter, { location: '/works/hello' }, createElement(comp, PROPS)),
    )
    assemble(ssrHtml, 'work-page', serializeProps(PROPS))
    window.history.pushState({}, '', '/works/hello')
    resetSeenMarkers()

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let hydrationErrors: unknown[][] = []
    let warns: unknown[][] = []
    try {
      await act(async () => {
        createClientEntry({ routes: table, mount: mountAt('/works/hello'), matchPage: matchRoutePage })
      })
      // Snapshot BEFORE mockRestore: in vitest mockRestore() also resets the
      // call history, so calls must be captured while the spy is installed.
      hydrationErrors = errSpy.mock.calls.map((c) => [...c])
      warns = warnSpy.mock.calls.map((c) => [...c])
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
    // The component was hydrated with the server props (marker 'from-ssr'
    // flows through routeTable keying; without props it renders 'no-props'),
    // and hydration stayed clean and silent.
    expect(seenMarkers()).toContain('from-ssr')
    expect(document.querySelector('[data-marker]')?.textContent).toBe('from-ssr')
    expect(hydrationErrors).toEqual([])
    expect(warns).toEqual([])
  })

  // #29 — the actual fix: NO consumer matchPage at all. The default
  // matchPageByPath resolves the owning page from the client table's own path
  // patterns (string literals survive minification), so the minified pageId
  // mismatch no longer costs the page its props.
  it('no matchPage at all -> default matcher delivers props despite the minified pageId mismatch', async () => {
    const comp = await minifiedWorkPage()
    const table = routeTable({ '/works/:slug': { component: comp, render: 'static' } }, reactRouterAssembler())
    expect(table.pages[0]?.pageId).not.toBe('work-page')

    const ssrHtml = renderToString(
      createElement(StaticRouter, { location: '/works/hello' }, createElement(comp, PROPS)),
    )
    assemble(ssrHtml, 'work-page', serializeProps(PROPS))
    window.history.pushState({}, '', '/works/hello')
    resetSeenMarkers()

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const missEvents: unknown[] = []
    const onMiss = (ev: Event) => missEvents.push((ev as CustomEvent).detail)
    window.addEventListener('ploykit:hydration-miss', onMiss)
    let hydrationErrors: unknown[][] = []
    try {
      await act(async () => {
        // Deliberately NO matchPage: the default ladder must handle this.
        createClientEntry({ routes: table, mount: mountAt('/works/hello') })
      })
      hydrationErrors = errSpy.mock.calls.map((c) => [...c])
    } finally {
      errSpy.mockRestore()
      window.removeEventListener('ploykit:hydration-miss', onMiss)
    }
    // The component RECEIVED the SSR props (component-observed, not just DOM).
    expect(seenMarkers()).toContain('from-ssr')
    expect(document.querySelector('[data-marker]')?.textContent).toBe('from-ssr')
    expect(hydrationErrors).toEqual([])
    expect(missEvents).toEqual([])
  })

  it('pathname matches no route and the embedded pageId is absent from the client table -> one console.error + ploykit:hydration-miss event, mounted without props', async () => {
    const comp = await minifiedWorkPage()
    const table = routeTable({ '/works/:slug': { component: comp, render: 'static' } }, reactRouterAssembler())

    // Basename-style URL (/app prefix). The SSR HTML is rendered WITHOUT props
    // — the shape the client will receive — so hydration itself stays clean
    // and the structured diagnostic comes from the mismatch branch under test.
    const ssrHtml = renderToString(
      createElement(StaticRouter, { location: '/app/works/hello' }, createElement(comp, {})),
    )
    assemble(ssrHtml, 'work-page', serializeProps(PROPS))
    window.history.pushState({}, '', '/app/works/hello')
    resetSeenMarkers()

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const missDetails: unknown[] = []
    const onMiss = (ev: Event) => missDetails.push((ev as CustomEvent).detail)
    window.addEventListener('ploykit:hydration-miss', onMiss)
    let errors: unknown[][] = []
    try {
      await act(async () => {
        createClientEntry({ routes: table, mount: mountAt('/app/works/hello', '/app'), matchPage: matchRoutePage })
      })
      // Snapshot before mockRestore (see the first test).
      errors = errSpy.mock.calls.map((c) => [...c])
    } finally {
      errSpy.mockRestore()
      window.removeEventListener('ploykit:hydration-miss', onMiss)
    }
    expect(errors).toHaveLength(1)
    expect(String(errors[0]?.[0])).toContain('props script present but no route matched')
    expect(errors[0]?.[1]).toBe('/app/works/hello')
    expect(errors[0]?.[2]).toBe('work-page')
    // The structured signal: exactly one event carrying the pathname and the
    // embedded pageId, so server-side/monitoring can capture what the console
    // hides in a browser.
    expect(missDetails).toHaveLength(1)
    expect(missDetails[0]).toEqual({ pathname: '/app/works/hello', embeddedPageId: 'work-page' })
    // Still the hydrateRoot path (props script present), but the component got
    // no props key — loader-driven pages would render empty, which is exactly
    // what the event reports.
    expect(seenMarkers()).toContain('no-props')
    expect(seenMarkers()).not.toContain('from-ssr')
  })

  it('non-minified client table (pageId survives) + basename URL -> legacy embedded-pageId keying keeps props, no error', async () => {
    const table = routeTable({ '/legacy': { component: LegacyPage, render: 'static' } }, reactRouterAssembler())
    expect(table.pages[0]?.pageId).toBe('legacy-page')

    const ssrHtml = renderToString(
      createElement(StaticRouter, { location: '/legacy' }, createElement(LegacyPage, PROPS)),
    )
    assemble(ssrHtml, 'legacy-page', serializeProps(PROPS))
    window.history.pushState({}, '', '/app/legacy')

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let errors: unknown[][] = []
    try {
      await act(async () => {
        createClientEntry({ routes: table, mount: mountAt('/app/legacy', '/app'), matchPage: matchRoutePage })
      })
      // Snapshot before mockRestore (see the first test).
      errors = errSpy.mock.calls.map((c) => [...c])
    } finally {
      errSpy.mockRestore()
    }
    expect(errors).toEqual([])
    expect(document.querySelector('[data-marker]')?.textContent).toBe('from-ssr')
  })
})

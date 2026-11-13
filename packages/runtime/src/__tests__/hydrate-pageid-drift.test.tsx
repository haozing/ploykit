// audit §3.5① — dev-time pageId drift assertion. The two route tables (SSR
// bundle / client bundle) derive pageIds independently from component
// identifiers, and a naming slip (Login vs RegisterPage, displayName drift)
// makes the SSR-embedded pageId absent from the client table with zero
// symptoms (the pathname-match ladder step still delivers the props). This
// file pins the dev-only console.error that surfaces that drift, and the
// prod-shape silence (import.meta.env.DEV false -> no error).
import { act, createElement, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { createClientEntry, PROPS_SCRIPT_ID, serializeProps } from '../hydrate'
import { routeTable } from '../routes'
import { reactRouterAssembler } from '../router-react-router'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function ServerOnlyName(props: { marker?: string }) {
  return <p data-marker={props.marker ?? 'no-props'}>{props.marker ?? 'no-props'}</p>
}
// The drift: same component identity on both sides, but the client table
// derives its pageId from a DIFFERENT display name than the SSR table did —
// the exact shape of a naming slip between the two entry files.
function ClientRenamed(...args: unknown[]) {
  return (ServerOnlyName as unknown as (...a: unknown[]) => ReactElement)(...args)
}

const ssrTable = routeTable(
  { '/tools': { component: ServerOnlyName, render: 'static' } },
  reactRouterAssembler(),
)
const clientTable = routeTable(
  { '/tools': { component: ClientRenamed, render: 'static' } },
  reactRouterAssembler(),
)

interface MarkerProps {
  marker?: string
}

function mountAt(pathname: string) {
  return (children: ReactElement): ReactElement =>
    createElement(MemoryRouter, { initialEntries: [pathname] }, children)
}

async function hydrateWithDrift() {
  document.body.innerHTML = `<div id="root"><p data-marker="from-ssr">from-ssr</p></div>
<script type="application/json" id="${PROPS_SCRIPT_ID}" data-page-id="${ssrTable.pages[0]!.pageId}">${serializeProps({ marker: 'from-ssr' })}</script>`
  window.history.pushState({}, '', '/tools')
  await act(async () => {
    createClientEntry({ routes: clientTable, mount: mountAt('/tools') })
  })
  return document.querySelector('[data-marker]')?.textContent
}

describe('dev 期 pageId 漂移断言（audit §3.5①）', () => {
  it('两侧 pageId 漂移（pathname 兜住 props）→ DEV 下 console.error 一次，点名两侧 pageId', async () => {
    // Pin the precondition: this really is the drift shape.
    expect(ssrTable.pages[0]!.pageId).toBe('server-only-name')
    expect(clientTable.pages[0]!.pageId).toBe('client-renamed')

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const text = await hydrateWithDrift()
      // Props were still delivered by the pathname-match step...
      expect(text).toBe('from-ssr')
      // ...and the drift was named exactly once (message uses console
      // formatting args: message, embeddedPageId, pathname, matchedPageId).
      const driftErrors = errSpy.mock.calls.filter((c) =>
        String(c[0]).includes('pageId 漂移'),
      )
      expect(driftErrors).toHaveLength(1)
      expect(driftErrors[0]?.[1]).toBe('server-only-name')
      expect(driftErrors[0]?.[2]).toBe('/tools')
      expect(driftErrors[0]?.[3]).toBe('client-renamed')
    } finally {
      errSpy.mockRestore()
    }
  })

  it('同一形状但 import.meta.env.DEV=false（生产构建形状）→ 静默，无漂移报错', async () => {
    vi.stubEnv('DEV', false)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const text = await hydrateWithDrift()
      expect(text).toBe('from-ssr')
      expect(
        errSpy.mock.calls.filter((c) => String(c[0]).includes('pageId 漂移')),
      ).toHaveLength(0)
    } finally {
      errSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it('两侧 pageId 一致（内嵌 pageId 就在客户端表里）→ 即使 DEV 也无漂移报错', async () => {
    document.body.innerHTML = `<div id="root"><p data-marker="from-ssr">from-ssr</p></div>
<script type="application/json" id="${PROPS_SCRIPT_ID}" data-page-id="${clientTable.pages[0]!.pageId}">${serializeProps({ marker: 'from-ssr' })}</script>`
    window.history.pushState({}, '', '/tools')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await act(async () => {
        createClientEntry({ routes: clientTable, mount: mountAt('/tools') })
      })
      expect(
        errSpy.mock.calls.filter((c) => String(c[0]).includes('pageId 漂移')),
      ).toHaveLength(0)
    } finally {
      errSpy.mockRestore()
    }
  })
})


import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({ render: vi.fn() })),
  hydrateRoot: vi.fn(() => ({ render: vi.fn() })),
}))

import { createRoot, hydrateRoot } from 'react-dom/client'
import { createClientEntry, readPropsScript, serializeProps } from '../hydrate'
import { routeTable } from '../routes'

function Home() {
  return <div>home</div>
}
const table = routeTable({ '/': { component: Home } })


function mountPage(propsScript?: string) {
  document.body.innerHTML = '<div id="root"></div>'
  if (propsScript !== undefined) {
    const el = document.createElement('script')
    el.type = 'application/json'
    el.id = '__PLOYKIT_PROPS__'
    el.setAttribute('data-page-id', 'home')
    el.textContent = propsScript
    document.body.appendChild(el)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createClientEntry', () => {
  it('带 __PLOYKIT_PROPS__ script → hydrateRoot 同树水合（不走 createRoot）', () => {
    mountPage(serializeProps({ any: 'props' }))
    createClientEntry({ routes: table, mount: (c) => c })
    expect(hydrateRoot).toHaveBeenCalledTimes(1)
    expect(createRoot).not.toHaveBeenCalled()
  })

  it('无 props script → createRoot 挂 SPA（不走水合）', () => {
    mountPage()
    createClientEntry({ routes: table, mount: (c) => c })
    expect(createRoot).toHaveBeenCalledTimes(1)
    expect(hydrateRoot).not.toHaveBeenCalled()
  })

  it('缺 #root 抛错（接线错误显式暴露）', () => {
    document.body.innerHTML = ''
    expect(() => createClientEntry({ routes: table, mount: (c) => c })).toThrow(/root/)
  })
})

describe('P2-27/P3-59：null 归一化与畸形 JSON 定策', () => {
  it('props script 为 "null" → props 归一为 undefined（与服务端对称，解构默认值生效）', () => {
    mountPage('null')
    const payload = readPropsScript()
    expect(payload).toEqual({ pageId: 'home', props: undefined })
    expect('props' in (payload ?? {})).toBe(true)
  })

  it('props script 为合法对象 → 原样返回（null 归一化不影响真值）', () => {
    mountPage(serializeProps({ a: 1 }))
    expect(readPropsScript()).toEqual({ pageId: 'home', props: { a: 1 } })
  })

  it('P3-59：畸形 JSON → console.error 且按无标记处理（SPA 回落，不白屏）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mountPage('{"broken":')
    createClientEntry({ routes: table, mount: (c) => c })
    expect(createRoot).toHaveBeenCalledTimes(1)
    expect(hydrateRoot).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

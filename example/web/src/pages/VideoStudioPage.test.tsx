import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkspaceContext, type PKWorkspace } from '@ploykit/hooks'
import { RouterTestHarness } from '@ploykit/ui/router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoStudioPage } from './VideoStudioPage'

/** 工作室页权限门控：无 video:render → 渲染按钮 disabled（可见但不可点）。 */

vi.mock('../ws', () => {
  const noop = () => () => {}
  const client = {
    status: 'idle',
    connect: () => {},
    close: () => {},
    on: noop,
    onStatus: noop,
    subscribe: noop,
  }
  return { wsClient: client, setWsWorkspace: () => {} }
})

const IR = {
  version: 1,
  meta: { fps: 30, width: 1080, height: 1920, durationSec: 5 },
  script: '第一段文案\n\n第二段文案',
  words: [
    { index: 0, text: '第一段', start: 0, end: 0.5, source: 'estimated' },
    { index: 1, text: '第二段', start: 0.6, end: 1.1, source: 'estimated' },
  ],
  effects: [],
  elements: [],
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (url === '/api/video/projects/p1') {
    return json({
      project: { id: 'p1', title: '演示项目', script: IR.script, version: 1, updated_at: '2026-11-01T00:00:00Z' },
      ir: IR,
      version: 1,
    })
  }
  if (url === '/api/video/projects/p1/renders') return json({ items: [] })
  return json({ error: 'E_NOT_FOUND', message: 'not found' }, 404)
})

const ws = (perms: string[]): PKWorkspace => ({
  id: 'ws-1',
  slug: 'acme',
  name: 'Acme',
  plan_code: 'free',
  created_at: '2026-01-01T00:00:00Z',
  role: 'member',
  role_perms: perms,
})

function mount(perms: string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceContext.Provider value={{ current: ws(perms), switchTo: () => {}, clear: () => {} }}>
        <RouterTestHarness initialEntries={['/studio/p1']}>
          <VideoStudioPage projectId="p1" />
        </RouterTestHarness>
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VideoStudioPage 权限门控', () => {
  it('无 video:render（member）→ 渲染按钮 disabled，并给出权限说明', async () => {
    mount(['video:read', 'video:write'])
    expect(await screen.findByText('演示项目')).toBeInTheDocument()

    const renderBtn = screen.getByRole('button', { name: /^渲染$/ })
    expect(renderBtn).toBeDisabled()
    expect(renderBtn).toHaveAttribute('title', '渲染需要管理员/所有者权限')
    // 说明文字对读屏/视觉用户都可见——不是把按钮藏掉
    expect(screen.getByText(/渲染需要管理员\/所有者权限/)).toBeInTheDocument()
    // 有 video:write，保存/上传入口保持可用
    expect(screen.getByRole('button', { name: /上传素材/ })).toBeEnabled()
  })

  it('有 video:render → 渲染按钮可用', async () => {
    mount(['video:read', 'video:write', 'video:render'])
    expect(await screen.findByText('演示项目')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^渲染$/ })).toBeEnabled()
  })
})

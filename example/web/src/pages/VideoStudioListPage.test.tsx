import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkspaceContext, type PKWorkspace } from '@ploykit/hooks'
import { RouterTestHarness } from '@ploykit/ui/router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoStudioListPage } from './VideoStudioListPage'

/**
 * 列表页取数/模板流（契约级）：用后端真实 payload 形状驱动渲染，
 * 断言列表条数、模板对话框的「顶层 themes + canvas_w」读取、compose 入参。
 */

// WS 不参与列表页（只在工作室页消费）；避免 jsdom 真连 socket。
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

const workspace = (perms: string[]): PKWorkspace => ({
  id: 'ws-1',
  slug: 'acme',
  name: 'Acme',
  plan_code: 'free',
  created_at: '2026-01-01T00:00:00Z',
  role: 'member',
  role_perms: perms,
})

function mount(perms: string[] = ['video:read', 'video:write', 'video:render']) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceContext.Provider
        value={{ current: workspace(perms), switchTo: () => {}, clear: () => {} }}
      >
        <RouterTestHarness initialEntries={['/studio']}>
          <VideoStudioListPage />
        </RouterTestHarness>
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  )
}

type Call = { url: string; init?: RequestInit }

const calls: Call[] = []

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const TEMPLATES_PAYLOAD = {
  templates: [
    {
      key: 'vertical-bold',
      name: '竖版大字',
      description: '大标题 + 要点列表，适合口播带货',
      canvas_w: 1080,
      canvas_h: 1920,
      fps: 30,
      safe_margin: 72,
    },
    {
      key: 'square-card',
      name: '方形卡片',
      description: '信息密度高的方形版式',
      canvas_w: 1080,
      canvas_h: 1080,
      fps: 25,
      safe_margin: 64,
    },
  ],
  themes: [
    { key: 'midnight', name: '午夜', bg: '#0b0b12', fg: '#f5f5f7', accent: '#7c5cff', muted: '#3a3a46', font_scale: 1 },
    { key: 'daylight', name: '日光', bg: '#ffffff', fg: '#111111', accent: '#0a84ff', muted: '#d8d8dd', font_scale: 0.95 },
  ],
}

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init })
    if (url === '/config') return json({ csrf_token: 'csrf-test' })
    if (url === '/api/video/projects' && (init?.method ?? 'GET') === 'GET') {
      return json({
        items: [
          { id: 'p1', title: '项目甲', version: 1, updated_at: '2026-11-01T00:00:00Z' },
          { id: 'p2', title: '项目乙', version: 2, updated_at: '2026-11-02T00:00:00Z' },
          { id: 'p3', title: '项目丙', version: 5, updated_at: '2026-11-03T00:00:00Z' },
        ],
      })
    }
    if (url === '/api/video/templates') return json(TEMPLATES_PAYLOAD)
    if (url === '/api/video/projects' && init?.method === 'POST') {
      return json({ id: 'p-new', version: 1 }, 201)
    }
    if (url === '/api/video/projects/p-new/compose') {
      return json({ version: 2, cards: [], words_source: 'estimated' })
    }
    return json({ error: 'E_NOT_FOUND', message: 'not found' }, 404)
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VideoStudioListPage', () => {
  it('listProjects 的 {items:[...]} payload 渲染出正确数量（契约方向是 {items}）', async () => {
    mount()
    expect(await screen.findByText('项目甲')).toBeInTheDocument()
    expect(screen.getByText('项目乙')).toBeInTheDocument()
    expect(screen.getByText('项目丙')).toBeInTheDocument()
    // 三个项目链接（aria-label 打开项目 X）
    expect(screen.getAllByRole('link', { name: /打开项目/ })).toHaveLength(3)
    // 请求打到 /api/video/projects，且没带 ?items 之类的错误参数
    expect(calls.some((c) => c.url === '/api/video/projects')).toBe(true)
  })

  it('模板对话框：真实 payload（顶层 themes + canvas_w）可打开模板、选主题，compose 入参正确', async () => {
    mount()
    await screen.findByText('项目甲')

    fireEvent.click(screen.getByRole('button', { name: /从模板新建/ }))
    // 模板卡片出现（数量 = 目录里的模板数）
    const cards = await screen.findAllByTestId('template-card')
    expect(cards).toHaveLength(2)
    // 模板卡片读 canvas_w/canvas_h（不是 canvasW），主题取顶层 themes[0] 画色板
    expect(within(cards[0]!).getByText('1080×1920 · 30fps')).toBeInTheDocument()
    expect(within(cards[1]!).getByText('1080×1080 · 25fps')).toBeInTheDocument()

    fireEvent.click(cards[0]!)
    // 第二步：主题单选（顶层 themes 两项），默认选中 themes[0]
    const themes = await screen.findAllByTestId('theme-option')
    expect(themes).toHaveLength(2)
    expect(themes[0]).toHaveAttribute('aria-checked', 'true')
    expect(themes[1]).toHaveAttribute('aria-checked', 'false')

    fireEvent.change(screen.getByLabelText('剧本文案'), {
      target: { value: '第一段文案\n\n第二段文案' },
    })
    fireEvent.click(screen.getByRole('button', { name: /创建并组合/ }))

    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/video/projects/p-new/compose')).toBe(true)
    })
    const compose = calls.find((c) => c.url === '/api/video/projects/p-new/compose')!
    expect(JSON.parse(String(compose.init?.body))).toEqual({
      script: '第一段文案\n\n第二段文案',
      template: 'vertical-bold',
      theme: 'midnight',
    })
  })

  it('无 video:write 时不显示新建入口（role_perms 门控）', async () => {
    mount(['video:read'])
    await screen.findByText('项目甲')
    expect(screen.queryByRole('button', { name: /从模板新建/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /空白项目/ })).not.toBeInTheDocument()
  })
})

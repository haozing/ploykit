import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fileUrl,
  previewUrl,
  videoApi,
  withWorkspaceId,
  VIDEO_ASSET_MAX_BYTES,
} from './video'

/**
 * api/video.ts 的契约层测试（不渲染）：
 * - URL 构造：浏览器原生 GET 必须带 ?workspace_id=（workspace 中间件的
 *   GET-only query 回退），已有 query 时用 &，绝对 URL 直通。
 * - listProjects：后端契约 {items}（裸数组是旧后端，兼容读）。
 * - uploadAsset：FormData 同时含 file 与 project_id（后端强制 project_id）。
 * - submitRender：body 是 {params} 且带 Idempotency-Key。
 */

type FetchCall = { url: string; init: RequestInit | undefined; body: FormData | null }

const calls: FetchCall[] = []

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const body = init?.body instanceof FormData ? init.body : null
    calls.push({ url, init, body })
    if (url === '/config') return jsonResponse({ csrf_token: 'csrf-test' })
    return jsonResponse({ ok: true })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('withWorkspaceId / previewUrl / fileUrl（纯函数）', () => {
  it('previewUrl 带 workspace_id（比 iframe 只能发原生 GET）', () => {
    expect(previewUrl('p-1', 'ws-1'))
      .toBe('/api/video/projects/p-1/preview.html?workspace_id=ws-1')
  })

  it('fileUrl 三种入参：裸 key / 已拼好的相对路径 / 绝对 URL', () => {
    // 裸 key → 补 /api/video/files/ 前缀
    expect(fileUrl('video/ws-1/assets/a.png', 'ws-1'))
      .toBe('/api/video/files/video/ws-1/assets/a.png?workspace_id=ws-1')
    // 后端 Render.output_url 已是 /api/video/files/... → 只追加 query
    expect(fileUrl('/api/video/files/video/ws-1/render/r1/output.mp4', 'ws-1'))
      .toBe('/api/video/files/video/ws-1/render/r1/output.mp4?workspace_id=ws-1')
    // 绝对 URL（S3 预签名）→ 原样返回，不破坏签名
    const signed = 'https://bucket.s3.amazonaws.com/k?X-Amz-Signature=abc'
    expect(fileUrl(signed, 'ws-1')).toBe(signed)
  })

  it('已有 query 时用 & 追加，不产生第二个 ?', () => {
    expect(withWorkspaceId('/api/video/files/k?download=1', 'ws-1'))
      .toBe('/api/video/files/k?download=1&workspace_id=ws-1')
    expect(fileUrl('/api/video/files/k?download=1', 'ws-1').match(/\?/g)).toHaveLength(1)
  })

  it('workspace 尺寸上限常量 = 50MiB（后端 UploadLimitLarge）', () => {
    expect(VIDEO_ASSET_MAX_BYTES).toBe(50 * 1024 * 1024)
  })
})

describe('videoApi 请求形状', () => {
  it('listProjects 读 {items} 契约；裸数组（旧后端）也兼容', async () => {
    const items = [
      { id: 'p1', title: '甲', version: 1, updated_at: '2026-11-01T00:00:00Z' },
      { id: 'p2', title: '乙', version: 3, updated_at: '2026-11-02T00:00:00Z' },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items })))
    await expect(videoApi.listProjects()).resolves.toEqual({ items })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(items)))
    await expect(videoApi.listProjects()).resolves.toEqual({ items })
  })

  it('uploadAsset：FormData 同时含 file 与 project_id', async () => {
    const file = new File(['hello'], 'voice.mp3', { type: 'audio/mpeg' })
    await videoApi.uploadAsset(file, 'proj-9')

    // 写请求前 apiFetch 会先打一次 /config 取 CSRF token——只关心上传那次。
    const uploads = calls.filter((c) => c.url === '/api/video/assets')
    expect(uploads).toHaveLength(1)
    const call = uploads[0]!
    expect(call.init?.method).toBe('POST')
    expect(call.body).toBeInstanceOf(FormData)
    expect(call.body!.get('project_id')).toBe('proj-9')
    const sent = call.body!.get('file')
    expect(sent).toBeInstanceOf(File)
    expect((sent as File).name).toBe('voice.mp3')
    // multipart 不能被 JSON 序列化：body 必须是原始 FormData
    expect(typeof call.init?.body).toBe('object')
    expect(call.init?.body).toBeInstanceOf(FormData)
  })

  it('submitRender：body 为 {params} 且带 Idempotency-Key', async () => {
    await videoApi.submitRender('p1', { subtitle_mode: 'soft' }, 'idem-123')

    const render = calls.find((c) => c.url === '/api/video/projects/p1/renders')
    expect(render).toBeDefined()
    expect(render!.init?.method).toBe('POST')
    const headers = new Headers(render!.init?.headers)
    expect(headers.get('Idempotency-Key')).toBe('idem-123')
    expect(JSON.parse(String(render!.init?.body))).toEqual({ params: { subtitle_mode: 'soft' } })
  })
})

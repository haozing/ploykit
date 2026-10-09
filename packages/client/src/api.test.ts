
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, ApiError, DEFAULT_TIMEOUT_MS, isApiError, __resetApiForTests } from './api'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}


function hangingFetch(): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return (_input, init) =>
    new Promise<Response>((_, reject) => {
      const sig = init?.signal
      if (sig?.aborted) {
        reject(sig.reason ?? new Error('aborted'))
        return
      }
      sig?.addEventListener('abort', () => reject(sig.reason ?? new Error('aborted')))
    })
}

beforeEach(() => {
  __resetApiForTests()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch 基础行为（回归）', () => {
  it('GET 解析 JSON 并返回数据体', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [1, 2] }))
    const data = await apiFetch<{ items: number[] }>('/api/x')
    expect(data).toEqual({ items: [1, 2] })
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/x')
    expect(init.method).toBe('GET')
  })

  it('写请求先拉 /config bootstrap，并带 X-CSRF-Token', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ csrf_token: 'tok-1' }))
    fetchMock.mockImplementationOnce(async () => jsonResponse({ ok: true, csrf_token: 'tok-2' }))
    await apiFetch('/api/x', { method: 'POST', body: { a: 1 } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('/config')
    const init = fetchMock.mock.calls[1][1] as RequestInit
    const headers = init.headers as Headers
    expect(headers.get('X-CSRF-Token')).toBe('tok-1')
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('错误信封 → ApiError(status, code)，isApiError 可判别', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'E_VALIDATION', message: 'bad' }, 400))
    const err = await apiFetch('/api/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(isApiError(err, 'E_VALIDATION')).toBe(true)
    expect((err as ApiError).status).toBe(400)
    expect((err as ApiError).message).toBe('bad')
  })
})

describe('FT-D3：apiFetch 超时', () => {
  it('默认 15s，可经 timeoutMs 覆盖（导出常量供产品引用）', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(15000)
  })

  it('悬挂请求到点中止，抛 code=E_TIMEOUT 的 ApiError（status=0）', async () => {
    fetchMock.mockImplementation(hangingFetch())
    const start = Date.now()
    const err = await apiFetch('/api/x', { timeoutMs: 50 }).catch((e: unknown) => e)
    expect(Date.now() - start).toBeGreaterThanOrEqual(45)
    expect(isApiError(err, 'E_TIMEOUT')).toBe(true)
    expect((err as ApiError).status).toBe(0)
    expect((err as ApiError).message).toContain('50ms')
  })

  it('写请求的 /config bootstrap 同样受超时保护', async () => {
    fetchMock.mockImplementation(hangingFetch())
    const err = await apiFetch('/api/x', { method: 'POST', body: {}, timeoutMs: 40 }).catch(
      (e: unknown) => e,
    )
    expect(isApiError(err, 'E_TIMEOUT')).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('/config')
  })

  it('timeoutMs<=0 不限时：不注入内部超时 signal，请求正常完成', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ ok: 1 }))
    const data = await apiFetch('/api/x', { timeoutMs: 0 })
    expect(data).toEqual({ ok: 1 })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeUndefined() 
  })

  it('caller 自带 signal 中止 → code=E_ABORTED（与超时区分）', async () => {
    fetchMock.mockImplementation(hangingFetch())
    const ac = new AbortController()
    setTimeout(() => ac.abort(new Error('user cancel')), 20)
    const err = await apiFetch('/api/x', { signal: ac.signal, timeoutMs: 5000 }).catch(
      (e: unknown) => e,
    )
    expect(isApiError(err, 'E_ABORTED')).toBe(true)
  })

  it('caller signal 已中止时立即拒绝（不等待）', async () => {
    fetchMock.mockImplementation(hangingFetch())
    const ac = new AbortController()
    ac.abort(new Error('cancelled'))
    const err = await apiFetch('/api/x', { signal: ac.signal, timeoutMs: 5000 }).catch(
      (e: unknown) => e,
    )
    expect(isApiError(err, 'E_ABORTED')).toBe(true)
  })
})


import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, ApiError, DEFAULT_TIMEOUT_MS, isApiError, __resetApiForTests } from './api'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Machine-readable CSRF rejection (webx writeCSRFError shape).
function csrfReject(): Response {
  return jsonResponse(
    {
      error: 'E_FORBIDDEN',
      message: 'CSRF token missing or invalid',
      details: { csrf_rejected: true, reason: 'CSRF token invalid' },
    },
    403,
  )
}

// Minimal Storage stand-in for the reload-loop guard tests: the suite runs in
// the default node environment, so `sessionStorage` (and `location`) only
// exist when a test explicitly stubs them via stubBrowser() below.
function makeSessionStorage(initial: Record<string, string> = {}): Storage {
  const backing = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => (backing.has(key) ? (backing.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      backing.set(key, String(value))
    },
    removeItem: (key: string) => {
      backing.delete(key)
    },
    clear: () => backing.clear(),
    key: (index: number) => [...backing.keys()][index] ?? null,
    get length() {
      return backing.size
    },
  } as unknown as Storage
}

// Pretend we are in a browser: define the `location` / `sessionStorage` globals
// the last-resort reload path checks for. afterEach's vi.unstubAllGlobals
// removes both again, so every test starts without browser globals.
function stubBrowser(reloadGuard?: string): { reload: ReturnType<typeof vi.fn> } {
  const reload = vi.fn()
  vi.stubGlobal('location', { reload })
  vi.stubGlobal(
    'sessionStorage',
    makeSessionStorage(reloadGuard === undefined ? {} : { 'ploykit-csrf-reload': reloadGuard }),
  )
  return { reload }
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

describe('CSRF 403 self-heal', () => {
  it('标记型 CSRF 403 → 清缓存重拉 /config，恰好重试一次并成功', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ csrf_token: 'tok-old' })) // initial bootstrap
    fetchMock.mockImplementationOnce(async () => csrfReject()) // send #1 rejected
    fetchMock.mockImplementationOnce(async () => jsonResponse({ csrf_token: 'tok-new' })) // self-heal re-bootstrap
    fetchMock.mockImplementationOnce(async () => jsonResponse({ ok: true })) // send #2 succeeds

    const data = await apiFetch<{ ok: boolean }>('/api/x', { method: 'POST', body: { a: 1 } })
    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(4) // bootstrap + send + re-bootstrap + send

    const send1 = fetchMock.mock.calls[1][1] as RequestInit
    const send2 = fetchMock.mock.calls[3][1] as RequestInit
    expect(fetchMock.mock.calls[1][0]).toBe('/api/x')
    expect(fetchMock.mock.calls[3][0]).toBe('/api/x')
    expect((send1.headers as Headers).get('X-CSRF-Token')).toBe('tok-old')
    expect((send2.headers as Headers).get('X-CSRF-Token')).toBe('tok-new')
    // the retry re-sends the exact same payload (body serialized once, before the send loop)
    expect(send2.body).toBe(JSON.stringify({ a: 1 }))
  })

  it('旧服务器兼容：无标记但 message 含 CSRF 的 403 同样触发自愈重试', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ csrf_token: 'tok-old' }))
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ error: 'E_FORBIDDEN', message: 'CSRF token missing or invalid' }, 403),
    )
    fetchMock.mockImplementationOnce(async () => jsonResponse({ csrf_token: 'tok-new' }))
    fetchMock.mockImplementationOnce(async () => jsonResponse({ ok: true }))

    const data = await apiFetch<{ ok: boolean }>('/api/x', { method: 'POST', body: { a: 1 } })
    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const send2 = fetchMock.mock.calls[3][1] as RequestInit
    expect((send2.headers as Headers).get('X-CSRF-Token')).toBe('tok-new')
  })

  it('普通权限 403（无标记、无 CSRF 字样）→ 不重试，错误照旧抛出', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ csrf_token: 'tok-1' }))
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ error: 'E_FORBIDDEN', message: 'insufficient permission' }, 403),
    )

    const err = await apiFetch('/api/x', { method: 'POST', body: { a: 1 } }).catch((e: unknown) => e)
    expect(isApiError(err, 'E_FORBIDDEN')).toBe(true)
    expect((err as ApiError).message).toBe('insufficient permission')
    expect(fetchMock).toHaveBeenCalledTimes(2) // bootstrap + exactly one send, no second /config
    expect(fetchMock.mock.calls[1][0]).toBe('/api/x')
  })

  it('重试仍被拒（非浏览器环境，无 location/sessionStorage）→ 第二次错误照旧抛出（不循环、不 reload）', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ csrf_token: 'tok-old' }))
    fetchMock.mockImplementationOnce(async () => csrfReject())
    fetchMock.mockImplementationOnce(async () => jsonResponse({ csrf_token: 'tok-new' }))
    fetchMock.mockImplementationOnce(async () => csrfReject())

    const err = await apiFetch('/api/x', { method: 'POST', body: { a: 1 } }).catch((e: unknown) => e)
    expect(isApiError(err, 'E_FORBIDDEN')).toBe(true)
    expect((err as ApiError).message).toContain('CSRF')
    expect((err as ApiError).details).toMatchObject({ csrf_rejected: true })
    expect(fetchMock).toHaveBeenCalledTimes(4) // no third send
    const lastInit = fetchMock.mock.calls[3][1] as RequestInit
    expect((lastInit.headers as Headers).get('X-CSRF-Token')).toBe('tok-new')
  })
})

describe('CSRF self-heal 单飞与兜底刷新', () => {
  // Double-403 sequencing shared by the reload tests: initial bootstrap, then
  // send #1 rejected, heal re-bootstrap, then the RETRIED send rejected again.
  function mockDoubleCsrfRejection(): void {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ csrf_token: 'tok-old' })) // initial bootstrap
    fetchMock.mockImplementationOnce(async () => csrfReject()) // send #1 rejected
    fetchMock.mockImplementationOnce(async () => jsonResponse({ csrf_token: 'tok-new' })) // heal re-bootstrap
    fetchMock.mockImplementationOnce(async () => csrfReject()) // retried send rejected again
  }

  it('并发风暴：4 个写请求同时 403，自愈单飞 —— /config 仅重拉一次，全部最终成功', async () => {
    let configFetches = 0
    let firstWaveSends = 0
    const parked: Array<(res: Response) => void> = []
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input)
      if (path === '/config') {
        configFetches++
        return jsonResponse({ csrf_token: `tok-${configFetches}` })
      }
      const token = (init?.headers as Headers).get('X-CSRF-Token')
      if (token === 'tok-2') return jsonResponse({ ok: true }) // post-heal retries succeed
      // First-wave send (stale tok-1): park it until all four first sends are
      // in flight, then reject them together — a genuinely concurrent storm,
      // so all four 403s hit the heal at the same time.
      firstWaveSends++
      if (firstWaveSends === 4) {
        for (const resolve of parked.splice(0)) resolve(csrfReject())
        return csrfReject()
      }
      return new Promise<Response>((resolve) => {
        parked.push(resolve)
      })
    })

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        apiFetch<{ ok: boolean }>('/api/x', { method: 'POST', body: { i } }),
      ),
    )

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }])
    expect(firstWaveSends).toBe(4) // each request sent exactly once before the heal
    expect(configFetches).toBe(2) // initial bootstrap + exactly ONE shared heal refetch
    const configCalls = fetchMock.mock.calls.filter(([p]) => String(p) === '/config')
    expect(configCalls).toHaveLength(2)
    const sendCalls = fetchMock.mock.calls.filter(([p]) => String(p) === '/api/x')
    expect(sendCalls).toHaveLength(8) // 4 rejected + 4 retried, no extra churn
  })

  it('重试仍被拒（浏览器环境）→ 兜底 location.reload 恰好一次，抛 E_CSRF_RELOADING，并写入守卫时间戳', async () => {
    const { reload } = stubBrowser()
    mockDoubleCsrfRejection()

    const err = await apiFetch('/api/x', { method: 'POST', body: { a: 1 } }).catch((e: unknown) => e)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(isApiError(err, 'E_CSRF_RELOADING')).toBe(true)
    expect((err as ApiError).status).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(4) // no third send — reload takes over
    expect(sessionStorage.getItem('ploykit-csrf-reload')).not.toBeNull() // window recorded
  })

  it('10s 守卫窗口内不二次 reload（已在窗口内）→ 不调 reload，走普通错误路径', async () => {
    const { reload } = stubBrowser(String(Date.now() - 1000)) // reload happened 1s ago
    mockDoubleCsrfRejection()

    const err = await apiFetch('/api/x', { method: 'POST', body: { a: 1 } }).catch((e: unknown) => e)
    expect(reload).not.toHaveBeenCalled()
    expect(isApiError(err, 'E_FORBIDDEN')).toBe(true) // original error falls through
    expect((err as ApiError).details).toMatchObject({ csrf_rejected: true })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('守卫时间戳超过 10s → 允许再次 reload（窗口已过期）', async () => {
    const { reload } = stubBrowser(String(Date.now() - 10_001)) // guard expired
    mockDoubleCsrfRejection()

    const err = await apiFetch('/api/x', { method: 'POST', body: { a: 1 } }).catch((e: unknown) => e)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(isApiError(err, 'E_CSRF_RELOADING')).toBe(true)
  })
})

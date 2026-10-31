

// Error taxonomy: 'business' = the application answered (fix your input /
// permissions per its message); 'gateway' = an answer arrived but not from the
// application — proxy error pages, gateway timeouts, non-JSON bodies (retry
// later, do NOT show "change your parameters" copy); 'network' = no answer at
// all — transport failure or caller abort (check connection / retry later).
// Derived from (status, code) at construction so every throw site — including
// future ones — carries it. shuijing field report: a 504 E_TIMEOUT was shown
// as "these parameters produce no plan" for many rounds because callers had
// to reverse-engineer this classification from scattered status/code checks.
export type ApiErrorKind = 'business' | 'network' | 'gateway'

function classifyKind(status: number, code: string): ApiErrorKind {
  if (code === 'E_ABORTED' || code === 'E_NETWORK') return 'network'
  if (code === 'E_TIMEOUT' || code === 'E_MALFORMED_RESPONSE' || code === 'E_CSRF_BOOTSTRAP') return 'gateway'
  if (status === 502 || status === 503 || status === 504) return 'gateway'
  return 'business'
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  readonly kind: ApiErrorKind

  readonly retryAfter?: number
  constructor(status: number, code: string, message: string, details?: unknown, retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.kind = classifyKind(status, code)
    this.details = details
    this.retryAfter = retryAfter
  }
}

// Wrap a raw fetch rejection (transport failure / abort) into the ApiError
// taxonomy. Before this, a dead server threw a bare TypeError("Failed to
// fetch") with no status/code/kind — unclassifiable by UI error mapping.
function toTransportError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (err instanceof Error && err.name === 'AbortError') {
    return new ApiError(0, 'E_ABORTED', 'request aborted')
  }
  const msg = err instanceof Error ? err.message : String(err)
  return new ApiError(0, 'E_NETWORK', `network request failed: ${msg}`)
}

export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code)
}

let csrfToken: string | null = null
let csrfBootstrap: Promise<void> | null = null
// Single-flight guard for the CSRF self-heal (see healCsrf below): concurrent
// 403s must share one clear+bootstrap cycle instead of each running its own.
let csrfHeal: Promise<void> | null = null

type WorkspaceIdProvider = () => string | null
let workspaceIdProvider: WorkspaceIdProvider = () => null


export function setWorkspaceIdProvider(provider: WorkspaceIdProvider): void {
  workspaceIdProvider = provider
}


function ensureCsrfToken(timeoutMs: number): Promise<void> {
  if (csrfToken) return Promise.resolve()
  csrfBootstrap ??= fetchWithTimeout('/config', { method: 'GET', credentials: 'same-origin' }, timeoutMs)
    .then(async ({ response, readBody }) => {
      if (!response.ok) throw new ApiError(response.status, 'E_CSRF_BOOTSTRAP', `CSRF bootstrap failed (${response.status})`)
      const data = await readBody(() => response.json()) as { csrf_token?: string }
      if (!data.csrf_token) throw new ApiError(0, 'E_CSRF_BOOTSTRAP', 'CSRF bootstrap: response missing csrf_token')
      csrfToken = data.csrf_token
    })
    .catch((err: unknown) => {
      csrfBootstrap = null
      throw err
    })
  return csrfBootstrap
}

function maybeRefreshCsrf(data: unknown): void {
  if (
    typeof data === 'object' &&
    data !== null &&
    'csrf_token' in data &&
    typeof (data as { csrf_token: unknown }).csrf_token === 'string'
  ) {
    csrfToken = (data as { csrf_token: string }).csrf_token
  }
}


// Self-heal for a CSRF rejection: drop the stale cached token and re-bootstrap
// from /config. Single-flight on purpose — clearing csrfBootstrap inside the
// heal (the v0.7.4 behavior) removed the only guard protecting /config, so N
// concurrent 403s each triggered their own serial refetch (a thundering herd;
// behind a proxy that intermittently drops cookies the storm could keep
// failing). All concurrent rejections now await the SAME clear+bootstrap
// cycle; a rejection arriving after the cycle settled starts a fresh one.
function healCsrf(timeoutMs: number): Promise<void> {
  csrfHeal ??= (async () => {
    csrfToken = null
    csrfBootstrap = null
    await ensureCsrfToken(timeoutMs)
  })().finally(() => { csrfHeal = null })
  return csrfHeal
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  
  responseType?: 'json' | 'blob'
  
  timeoutMs?: number
}


export const DEFAULT_TIMEOUT_MS = 15000


interface TimedFetch {
  response: Response
  
  readBody<T>(read: () => Promise<T>): Promise<T>
}


async function fetchWithTimeout(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<TimedFetch> {
  const outer = init.signal
  if (!timeoutMs || timeoutMs <= 0) {
    let response: Response
    try {
      response = await fetch(path, init)
    } catch (err) {
      throw toTransportError(err)
    }
    return { response, readBody: (read) => read() }
  }
  if (outer?.aborted) {
    
    throw new ApiError(0, 'E_ABORTED', 'request aborted by caller')
  }
  const controller = new AbortController()
  const startedAt = Date.now()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const cascade = () => controller.abort()
  if (outer) {
    if (outer.aborted) controller.abort()
    else outer.addEventListener('abort', cascade)
  }
  try {
    const response = await fetch(path, { ...init, signal: controller.signal })
    
    
    clearTimeout(timer)
    return {
      response,
      readBody: async <T,>(read: () => Promise<T>): Promise<T> => {
        const remaining = timeoutMs - (Date.now() - startedAt)
        if (remaining <= 0) {
          timedOut = true
          controller.abort()
          throw new ApiError(0, 'E_TIMEOUT', `request timed out after ${timeoutMs}ms`)
        }
        let bodyTimedOut = false
        const bodyTimer = setTimeout(() => {
          bodyTimedOut = true
          controller.abort()
        }, remaining)
        try {
          return await read()
        } catch (err) {
          if (bodyTimedOut) {
            throw new ApiError(0, 'E_TIMEOUT', `request timed out after ${timeoutMs}ms`)
          }
          throw err
        } finally {
          clearTimeout(bodyTimer)
        }
      },
    }
  } catch (err) {
    if (timedOut) {
      throw new ApiError(0, 'E_TIMEOUT', `request timed out after ${timeoutMs}ms`)
    }
    if (outer?.aborted) {


      throw new ApiError(0, 'E_ABORTED', 'request aborted by caller')
    }
    throw toTransportError(err)
  } finally {
    clearTimeout(timer)
    if (outer) outer.removeEventListener('abort', cascade)
  }
}


function parseRetryAfter(res: Response): number | undefined {
  const v = res.headers.get('retry-after')
  if (!v) return undefined
  const n = Number(v)
  if (Number.isFinite(n) && v.trim() !== '' && n >= 0) return Math.floor(n)
  const at = Date.parse(v)
  if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000))
  return undefined
}


// A CSRF rejection is either the framework's machine-readable marker
// (details.csrf_rejected, set by webx writeCSRFError) or — backward compat
// with servers older than the marker — a 403 whose message text names CSRF.
function isCsrfRejection(status: number, body: { error?: unknown; message?: unknown; details?: unknown }): boolean {
  const details = body.details
  if (
    details !== null &&
    typeof details === 'object' &&
    (details as { csrf_rejected?: unknown }).csrf_rejected === true
  ) {
    return true
  }
  return status === 403 && typeof body.message === 'string' && body.message.includes('CSRF')
}


export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = options.method?.toUpperCase() ?? 'GET'
  const isWrite = method !== 'GET' && method !== 'HEAD'
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (isWrite) await ensureCsrfToken(timeoutMs)

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  // Serialize the body once, before the send loop below: a retry must re-send
  // the exact same payload, and JSON.stringify output is a plain string that
  // is safely reusable (the raw FormData object is passed through untouched).
  const requestBody =
    options.body === undefined
      ? undefined
      : isFormData
        ? (options.body as FormData)
        : JSON.stringify(options.body)

  // At most two sends: a CSRF rejection on the first attempt self-heals by
  // re-bootstrapping a fresh masked token (the cached one can go stale when
  // the ploykit_csrf cookie expires or a bootstrap race cached the loser of
  // two concurrent /config responses); anything else fails as before.
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers(options.headers)
    if (options.body !== undefined && !isFormData && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    if (isWrite && csrfToken) headers.set('X-CSRF-Token', csrfToken)
    const workspaceId = workspaceIdProvider()
    if (workspaceId && path.startsWith('/api')) headers.set('X-Workspace-Id', workspaceId)

    const { response: res, readBody } = await fetchWithTimeout(
      path,
      {
        ...options,
        method,
        credentials: 'same-origin',
        headers,
        body: requestBody,
      },
      timeoutMs,
    )

    if (res.status === 204) return undefined as T
    if (options.responseType === 'blob') {
      if (!res.ok) {
        let body: { error?: unknown; message?: unknown; details?: unknown } = {}
        try {
          body = (await readBody(() => res.json())) as typeof body
        } catch (err) {
          
          if (isApiError(err)) throw err
        }
        if (typeof body?.error === 'string') {
          throw new ApiError(
            res.status,
            body.error,
            typeof body.message === 'string' ? body.message : '请求失败，请稍后重试',
            body.details,
            parseRetryAfter(res),
          )
        }
        throw new ApiError(res.status, 'E_MALFORMED_RESPONSE', `HTTP ${res.status} without error envelope`, undefined, parseRetryAfter(res))
      }
      return readBody(() => res.blob()) as T
    }
    let data: unknown
    try {
      data = await readBody(() => res.json())
    } catch (err) {
      if (isApiError(err, 'E_TIMEOUT')) throw err
      if (res.ok) return undefined as T
      throw new ApiError(res.status, 'E_MALFORMED_RESPONSE', `non-JSON response (${res.status})`, undefined, parseRetryAfter(res))
    }
    if (!res.ok) {
      
      const body = data as { error?: unknown; message?: unknown; details?: unknown }
      if (isCsrfRejection(res.status, body)) {
        if (attempt === 0) {
          // Self-heal: drop the stale cached token, re-bootstrap from /config,
          // and retry exactly once. Concurrent rejections share a single
          // clear+bootstrap cycle via healCsrf (single-flight). Timeout/abort
          // failures never reach this branch — they throw before any response
          // exists.
          await healCsrf(timeoutMs)
          continue
        }
        // Last resort: even the freshly bootstrapped token was rejected, so
        // client-side state alone cannot recover (e.g. a proxy keeps dropping
        // the ploykit_csrf cookie). A full page reload re-bootstraps cookies
        // and the masked token from scratch and is the only guaranteed
        // recovery. The sessionStorage timestamp allows at most one reload per
        // 10s window, preventing reload loops; inside that window (or outside
        // a browser) we fall through to the normal error path below.
        if (typeof location !== 'undefined' && typeof sessionStorage !== 'undefined') {
          const raw = sessionStorage.getItem('ploykit-csrf-reload')
          const last = raw === null ? NaN : Number(raw)
          if (!Number.isFinite(last) || Date.now() - last > 10_000) {
            // Mark the window, schedule the reload, and still throw so the
            // caller's promise settles before the page tears down.
            sessionStorage.setItem('ploykit-csrf-reload', String(Date.now()))
            location.reload()
            throw new ApiError(403, 'E_CSRF_RELOADING', 'CSRF state unrecoverable — reloading page')
          }
        }
      }
      if (typeof body?.error === 'string') {
        throw new ApiError(
          res.status,
          body.error,
          
          typeof body.message === 'string' ? body.message : '请求失败，请稍后重试',
          body.details,
          parseRetryAfter(res),
        )
      }
      throw new ApiError(res.status, 'E_MALFORMED_RESPONSE', `HTTP ${res.status} without error envelope`, undefined, parseRetryAfter(res))
    }
    maybeRefreshCsrf(data)
    return data as T
  }
  // Unreachable: attempt 0 either returns, throws, or continues, and the
  // attempt-1 iteration never continues (the retry branch requires
  // attempt === 0). Present only so the compiler sees a definite exit.
  throw new Error('unreachable')
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'DELETE', body }),
}


export function __resetApiForTests(): void {
  csrfToken = null
  csrfBootstrap = null
  csrfHeal = null
}



export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  
  readonly retryAfter?: number
  constructor(status: number, code: string, message: string, details?: unknown, retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.retryAfter = retryAfter
  }
}

export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code)
}

let csrfToken: string | null = null
let csrfBootstrap: Promise<void> | null = null

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
    
    
    const response = await fetch(path, init)
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
    throw err
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
      if (attempt === 0 && isCsrfRejection(res.status, body)) {
        // Self-heal: drop the stale cached token, re-bootstrap from /config,
        // and retry exactly once. A second rejection falls through to the
        // normal error path (no loop). Timeout/abort failures never reach
        // this branch — they throw before any response exists.
        csrfToken = null
        csrfBootstrap = null
        await ensureCsrfToken(timeoutMs)
        continue
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
}

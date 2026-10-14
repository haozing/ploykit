import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAuthState } from '../useAuthState'

// renderx-walk #5: useAuthState must work WITHOUT PloykitProvider — the whole
// point is product chrome outside AppShell. 401 maps to null (anonymous), the
// queryKey shares the provider's ['auth','me'] so the two views never diverge.
const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@ploykit/client', () => ({
  api: { get: fetchMock },
  ApiError: class extends Error {
    status: number
    constructor(status: number, msg: string) { super(msg); this.status = status }
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

afterEach(() => fetchMock.mockReset())

describe('useAuthState（无 Provider 可用）', () => {
  it('200 → user 透传', async () => {
    fetchMock.mockResolvedValueOnce({ id: 'u1', email: 'a@b.c' })
    const { result } = renderHook(() => useAuthState(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user?.id).toBe('u1')
    expect(fetchMock).toHaveBeenCalledWith('/auth/me')
  })

  it('401 → user 为 null 而非抛错（匿名态）', async () => {
    const { ApiError } = await import('@ploykit/client')
    fetchMock.mockRejectedValueOnce(new ApiError(401, 'unauth'))
    const { result } = renderHook(() => useAuthState(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('500 → error 透传（非 401 不吞）', async () => {
    const { ApiError } = await import('@ploykit/client')
    fetchMock.mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { result } = renderHook(() => useAuthState(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
    expect(result.current.error).toBeTruthy()
  })
})

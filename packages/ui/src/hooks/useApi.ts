
import { useCallback, useMemo } from 'react'
import { api, ApiError } from '@ploykit/client'

export { ApiError }
export type { ApiFetchOptions } from '@ploykit/client'

export function useApi() {
  const get = useCallback(<T,>(path: string): Promise<T> => api.get<T>(path), [])
  const post = useCallback(<T,>(path: string, body?: unknown): Promise<T> => api.post<T>(path, body), [])
  const put = useCallback(<T,>(path: string, body?: unknown): Promise<T> => api.put<T>(path, body), [])
  const patch = useCallback(<T,>(path: string, body?: unknown): Promise<T> => api.patch<T>(path, body), [])
  const del = useCallback(<T,>(path: string, body?: unknown): Promise<T> => api.delete<T>(path, body), [])

  
  
  return useMemo(() => ({ get, post, put, patch, delete: del }), [get, post, put, patch, del])
}

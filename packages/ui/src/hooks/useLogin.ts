
import { useCallback, useState } from 'react'
import { api } from '@ploykit/client'
import { useAuthCtx } from '../provider/PloykitProvider'

export interface UseLoginResult {
  sendCode(email: string): Promise<void>
  submit(email: string, code: string): Promise<{ ok: boolean; error?: string }>
  loading: boolean
  error: string | null
}

export function useLogin(): UseLoginResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { refresh } = useAuthCtx()

  const sendCode = useCallback(async (email: string) => {
    setError(null)
    setLoading(true)
    try {
      await api.post('/auth/send-code', { email })
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const submit = useCallback(async (email: string, code: string) => {
    setError(null); setLoading(true)
    try {
      await api.post('/auth/verify-code', { email, code })
      await refresh() 
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '登录失败'
      setError(msg)
      return { ok: false, error: msg }
    } finally {
      setLoading(false)
    }
  }, [refresh])

  return { sendCode, submit, loading, error }
}

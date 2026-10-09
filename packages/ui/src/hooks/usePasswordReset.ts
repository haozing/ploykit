
import { useCallback } from 'react'
import { useApi } from './useApi'

export interface UsePasswordResetResult {
  
  requestReset(email: string): Promise<void>
  
  reset(email: string, token: string, newPassword: string): Promise<void>
}

export function usePasswordReset(): UsePasswordResetResult {
  const api = useApi()

  const requestReset = useCallback(
    async (email: string) => {
      await api.post('/auth/forgot-password', { email })
    },
    [api],
  )

  const reset = useCallback(
    async (email: string, token: string, newPassword: string) => {
      await api.post('/auth/reset-password', { email, token, new_password: newPassword })
    },
    [api],
  )

  return { requestReset, reset }
}

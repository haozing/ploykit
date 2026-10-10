
import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@ploykit/client'
import {
  useAuthCtx, useWorkspaceCtx, queryKeys, type PKWorkspace,
} from '../provider/PloykitProvider'

export function useWorkspace() {
  return useWorkspaceCtx()
}

export function useWorkspaceSwitch() {
  const { workspaces } = useAuthCtx()
  const { current, switchTo } = useWorkspaceCtx()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  
  const [error, setError] = useState<unknown>(null)

  const create = useCallback(async (name: string, slug: string): Promise<PKWorkspace | null> => {
    setCreating(true); setError(null)
    try {
      
      
      const ws = await api.post<PKWorkspace>('/api/workspaces', { name, slug })
      await qc.invalidateQueries({ queryKey: queryKeys.workspace })
      switchTo(ws.id)
      return ws
    } catch (e) {
      
      setError(e); return null
    } finally {
      setCreating(false)
    }
  }, [qc, switchTo])

  return { current, list: workspaces, switchTo, create, creating, error }
}

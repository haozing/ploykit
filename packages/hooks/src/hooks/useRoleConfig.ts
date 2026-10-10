
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from './useApi'
import { useWorkspace } from './useWorkspace'
import { queryKeys } from '../provider/PloykitProvider'
import type { components } from '@ploykit/client'

export type PKRoleConfig = components['schemas']['RoleConfig']

export interface RoleConfigList {
  items: PKRoleConfig[]
  catalog: string[]
}

// 引用稳定的空集：避免无数据时每次渲染新建数组，触发以 roles 为依赖的
// useEffect 无限重建草稿（页面层 setDrafts 循环）。
const EMPTY_ITEMS: PKRoleConfig[] = []
const EMPTY_CATALOG: string[] = []

/**
 * 工作区角色权限矩阵（write side of workspace_role，覆盖=替换默认）。
 * 变更走 roles:manage + step-up：E_REAUTH_REQUIRED 由页面捕获并经
 * ReauthDialog（确认密码 → 重试）闭环 —— 见 ADR 0011 两段式协议。
 */
export function useRoleConfig() {
  const { current } = useWorkspace()
  const api = useApi()
  const qc = useQueryClient()
  const wsId = current?.id ?? ''

  const rolesQ = useQuery({
    queryKey: [...queryKeys.roleConfig(wsId)],
    queryFn: () => api.get<RoleConfigList>(`/api/workspaces/${wsId}/roles`),
    enabled: !!wsId,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.roleConfig(wsId) })

  const setPerms = useMutation({
    mutationFn: (v: { role: string; perms: string[] }) =>
      api.put<PKRoleConfig>(`/api/workspaces/${wsId}/roles/${v.role}`, { perms: v.perms }),
    onSuccess: invalidate,
  })

  const resetPerms = useMutation({
    mutationFn: (role: string) => api.delete<void>(`/api/workspaces/${wsId}/roles/${role}`),
    onSuccess: invalidate,
  })

  return {
    wsId,
    roles: rolesQ.data?.items ?? EMPTY_ITEMS,
    catalog: rolesQ.data?.catalog ?? EMPTY_CATALOG,
    loading: !!wsId && rolesQ.isPending,
    error: rolesQ.error,
    setPerms,
    resetPerms,
  }
}

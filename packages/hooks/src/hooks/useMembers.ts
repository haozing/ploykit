
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from './useApi'
import { useWorkspace } from './useWorkspace'
import { queryKeys, type PKWorkspace } from '../provider/PloykitProvider'
import type { components } from '@ploykit/client'



export type PKMember = components['schemas']['Member']
export type PKInvitation = components['schemas']['Invitation']
export type PKShareLink = components['schemas']['ShareLink']
export type PKInvitationWithWorkspace = components['schemas']['InvitationWithWorkspace']
export type PKMemberPage = components['schemas']['MemberPage']
export type PKInvitationPage = components['schemas']['InvitationPage']
export type PKShareLinkPage = components['schemas']['ShareLinkPage']


export interface ListQuery {
  page: number
  pageSize?: number
}


export interface ListPages {
  members: number
  invitations: number
  shareLinks: number
}


export const LIST_PAGE_SIZE = 50

const listQuery = (q: ListQuery): string =>
  `?page=${q.page}&page_size=${q.pageSize ?? LIST_PAGE_SIZE}`


export interface CreateShareLinkResult {
  link: PKShareLink
  code: string
}


export const ASSIGNABLE_ROLES = ['admin', 'member'] as const



export function useMembers(pages: ListPages) {
  const { current } = useWorkspace()
  const api = useApi()
  const wsId = current?.id ?? ''

  const membersQ = useQuery({
    queryKey: [...queryKeys.members(wsId), pages.members],
    queryFn: () => api.get<PKMemberPage>(`/api/workspaces/${wsId}/members${listQuery({ page: pages.members })}`),
    enabled: !!wsId,
  })
  const invitationsQ = useQuery({
    queryKey: [...queryKeys.invitations(wsId), pages.invitations],
    queryFn: () => api.get<PKInvitationPage>(`/api/workspaces/${wsId}/invitations${listQuery({ page: pages.invitations })}`),
    enabled: !!wsId,
  })
  const shareLinksQ = useQuery({
    queryKey: [...queryKeys.shareLinks(wsId), pages.shareLinks],
    queryFn: () => api.get<PKShareLinkPage>(`/api/workspaces/${wsId}/share-links${listQuery({ page: pages.shareLinks })}`),
    enabled: !!wsId,
  })

  return {
    wsId,
    
    myRole: current?.role ?? null,
    members: membersQ.data?.items ?? [],
    membersTotal: membersQ.data?.total ?? 0,
    invitations: invitationsQ.data?.items ?? [],
    invitationsTotal: invitationsQ.data?.total ?? 0,
    shareLinks: shareLinksQ.data?.items ?? [],
    shareLinksTotal: shareLinksQ.data?.total ?? 0,
    loading: !!wsId && (membersQ.isPending || invitationsQ.isPending || shareLinksQ.isPending),
    membersError: membersQ.error,
    invitationsError: invitationsQ.error,
    shareLinksError: shareLinksQ.error,
    refetchAll: async () => {
      await Promise.all([
        membersQ.refetch(),
        invitationsQ.refetch(),
        shareLinksQ.refetch(),
      ])
    },
  }
}



export function useMemberMutations() {
  const { current } = useWorkspace()
  const api = useApi()
  const qc = useQueryClient()
  const wsId = current?.id ?? ''
  const base = `/api/workspaces/${wsId}`

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.members(wsId) }),
      qc.invalidateQueries({ queryKey: queryKeys.invitations(wsId) }),
      qc.invalidateQueries({ queryKey: queryKeys.shareLinks(wsId) }),
    ])
  }

  const invite = useMutation({
    mutationFn: (v: { email: string; role: string }) =>
      api.post<PKInvitation>(`${base}/invitations`, v),
    onSuccess: invalidateAll,
  })

  const revokeInvitation = useMutation({
    mutationFn: (invId: string) => api.delete(`${base}/invitations/${invId}`),
    onSuccess: invalidateAll,
  })

  const updateRole = useMutation({
    mutationFn: (v: { userId: string; role: string }) =>
      api.patch(`${base}/members/${v.userId}`, { role: v.role }),
    onSuccess: invalidateAll,
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(`${base}/members/${userId}`),
    onSuccess: invalidateAll,
  })

  
  
  
  
  const transferOwnership = useMutation({
    mutationFn: (userId: string) => api.post(`${base}/transfer-ownership`, { user_id: userId }),
    onSuccess: async () => {
      await invalidateAll()
      await qc.invalidateQueries({ queryKey: queryKeys.workspace })
    },
  })

  const createShareLink = useMutation({
    mutationFn: (v: { role: string; max_uses: number; ttl_hours: number }) =>
      api.post<CreateShareLinkResult>(`${base}/share-links`, v),
    onSuccess: invalidateAll,
  })

  const revokeShareLink = useMutation({
    mutationFn: (linkId: string) => api.delete(`${base}/share-links/${linkId}`),
    onSuccess: invalidateAll,
  })

  return {
    invite, revokeInvitation, updateRole, removeMember, transferOwnership,
    createShareLink, revokeShareLink,
  }
}



export function useMyInvitations() {
  const api = useApi()
  const qc = useQueryClient()

  
  const list = useQuery({
    queryKey: queryKeys.myInvitations,
    queryFn: () => api.get<PKInvitationWithWorkspace[]>('/api/invitations/mine'),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.myInvitations })

  const accept = useMutation({
    mutationFn: (id: string) => api.post<PKWorkspace>(`/api/invitations/${id}/accept`),
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        
        qc.invalidateQueries({ queryKey: queryKeys.workspace }),
      ])
    },
  })

  const decline = useMutation({
    mutationFn: (id: string) => api.post(`/api/invitations/${id}/decline`),
    onSuccess: invalidate,
  })

  return {
    invitations: list.data ?? [],
    loading: list.isPending,
    error: list.error,
    refetch: list.refetch,
    accept,
    decline,
  }
}

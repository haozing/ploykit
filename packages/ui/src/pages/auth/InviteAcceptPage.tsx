
import { useNavigate } from 'react-router'
import { Check, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { PageLoading, PageEmpty } from '../../components/Page'
import { toast } from '../../components/toast'
import { useMyInvitations } from '@ploykit/hooks'
import { formatDateTime } from '../../lib/utils'
import { apiErrorMessage } from '../../lib/api-error'

const ROLE_LABEL: Record<string, string> = { owner: '所有者', admin: '管理员', member: '成员' }

export interface InviteAcceptPageProps {
  
  onAccepted?: (workspaceId: string) => void
  
  onDeclined?: () => void
}

export function InviteAcceptPage({ onAccepted, onDeclined }: InviteAcceptPageProps = {}) {
  const navigate = useNavigate()
  const { invitations, loading, error, refetch, accept, decline } = useMyInvitations()

  const pending = invitations.filter((i) => i.status === 'pending')

  const onAccept = async (id: string, name: string) => {
    try {
      const ws = await accept.mutateAsync(id)
      toast.success(`已加入「${name}」`)
      
      if (onAccepted) onAccepted(ws.id)
      else navigate('/app')
    } catch (e) {
      toast.error(apiErrorMessage(e, '接受邀请失败'))
    }
  }

  const onDecline = async (id: string, name: string) => {
    try {
      await decline.mutateAsync(id)
      toast.success(`已拒绝「${name}」的邀请`)
      onDeclined?.()
    } catch (e) {
      toast.error(apiErrorMessage(e, '操作失败'))
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted/40 p-6 md:p-10">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-bold">我的邀请</h1>
        <p className="mt-1 text-sm text-muted-foreground">接受后你将加入对应工作区。</p>

        <div className="mt-4">
          {loading ? (
            <PageLoading label="加载邀请…" />
          ) : error ? (
            <div className="py-6 text-center text-sm text-red-600">
              {apiErrorMessage(error, '邀请加载失败')}
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => refetch()}>重试</Button>
              </div>
            </div>
          ) : pending.length === 0 ? (
            <PageEmpty label="暂无待处理的邀请" hint="收到新邀请时会出现在这里" />
          ) : (
            <ul className="divide-y">
              {pending.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {inv.workspace_name || inv.workspace_slug || '工作区'}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{ROLE_LABEL[inv.role] ?? inv.role}</Badge>
                      <span>{formatDateTime(inv.expires_at)} 过期</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decline.isPending}
                      onClick={() => onDecline(inv.id, inv.workspace_name)}
                    >
                      <X /> 拒绝
                    </Button>
                    <Button
                      size="sm"
                      disabled={accept.isPending}
                      onClick={() => onAccept(inv.id, inv.workspace_name)}
                    >
                      <Check /> 接受
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

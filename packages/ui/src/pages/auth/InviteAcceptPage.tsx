
import { useNavigate } from '../../router'
import { Check, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { PageLoading, PageEmpty, PageError } from '../../components/Page'
import { toast } from '../../components/toast'
import { useMyInvitations } from '@ploykit/hooks'
import { formatDateTime, ROLE_LABEL } from '../../lib/utils'
import { apiErrorMessage } from '../../lib/api-error'
import { useT } from '../../i18n'

export interface InviteAcceptPageProps {

  onAccepted?: (workspaceId: string) => void

  onDeclined?: () => void
}

export function InviteAcceptPage({ onAccepted, onDeclined }: InviteAcceptPageProps = {}) {
  const navigate = useNavigate()
  const t = useT() // i18n（B 方案）：页面文案走字典（g7 分片 auth.invite.*）
  const { invitations, loading, error, refetch, accept, decline } = useMyInvitations()

  const pending = invitations.filter((i) => i.status === 'pending')

  const onAccept = async (id: string, name: string) => {
    try {
      const ws = await accept.mutateAsync(id)
      toast.success(t('auth.invite.acceptedToast', { name }))

      if (onAccepted) onAccepted(ws.id)
      else navigate('/app')
    } catch (e) {
      toast.error(apiErrorMessage(e, t('auth.invite.acceptFailed')))
    }
  }

  const onDecline = async (id: string, name: string) => {
    try {
      await decline.mutateAsync(id)
      toast.success(t('auth.invite.declinedToast', { name }))
      onDeclined?.()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('auth.invite.declineFailed')))
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted/40 p-6 md:p-10">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-bold">{t('auth.invite.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('auth.invite.desc')}</p>

        <div className="mt-4">
          {loading ? (
            <PageLoading label={t('auth.invite.loading')} />
          ) : error ? (
            <PageError
              message={apiErrorMessage(error, t('auth.invite.loadFailed'))}
              onRetry={() => refetch()}
            />
          ) : pending.length === 0 ? (
            <PageEmpty label={t('auth.invite.empty')} hint={t('auth.invite.emptyHint')} />
          ) : (
            <ul className="divide-y">
              {pending.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {inv.workspace_name || inv.workspace_slug || t('auth.invite.workspaceFallback')}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{ROLE_LABEL[inv.role] ?? inv.role}</Badge>
                      <span>{t('auth.invite.expires', { date: formatDateTime(inv.expires_at) })}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decline.isPending}
                      onClick={() => onDecline(inv.id, inv.workspace_name)}
                    >
                      <X aria-hidden="true" /> {t('auth.invite.decline')}
                    </Button>
                    <Button
                      size="sm"
                      disabled={accept.isPending}
                      onClick={() => onAccept(inv.id, inv.workspace_name)}
                    >
                      <Check aria-hidden="true" /> {t('auth.invite.accept')}
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

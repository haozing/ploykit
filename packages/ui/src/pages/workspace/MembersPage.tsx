
import { useState } from 'react'
import { useSearchParamsCompat } from '../../router'
import { t, useT } from '../../i18n'
import * as z from 'zod/mini'
import { UserPlus, Link2, MoreHorizontal } from 'lucide-react'
import {
  PageHeader, PageLoading, PageError, PageEmpty,
} from '../../components/Page'
import { DataTable, type Column } from '../../components/DataTable'
import { FormField } from '../../components/FormField'
import { SecretModal, ImpactConfirmation } from '../../components/SecretModal'
import { useConfirm } from '../../components/ConfirmDialog'
import { toast } from '../../components/toast'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import { StatusBadge } from '../../components/StatusBadge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/dialog'
import { useZodForm } from '@ploykit/hooks'
import {
  useMembers, useMemberMutations, ASSIGNABLE_ROLES, LIST_PAGE_SIZE,
  type PKMember, type PKInvitation, type PKShareLink,
} from '@ploykit/hooks'
import { formatDateTime, ROLE_LABEL } from '../../lib/utils'
import { apiErrorMessage } from '../../lib/api-error'
import { roleSatisfies } from '@ploykit/hooks'



// i18n（B 方案）：校验文案走 error 函数——safeParse 时才取字典，语言随 setUiLang 生效。
export const inviteSchema = z.object({
  email: z.string().check(
    z.minLength(1, { error: () => t('workspace.members.form.emailRequired') }),
    z.email({ error: () => t('workspace.members.form.emailInvalid') }),
  ),
  role: z.enum(['admin', 'member']),
})
type InviteForm = z.infer<typeof inviteSchema>

export const shareLinkSchema = z.object({
  role: z.enum(['admin', 'member']),
  max_uses: z.number().check(
    z.int({ error: () => t('workspace.members.form.mustBeInteger') }),
    z.minimum(1, { error: () => t('workspace.members.form.minUses') }),
    z.maximum(10000),
  ),
  ttl_hours: z.number().check(
    z.int({ error: () => t('workspace.members.form.mustBeInteger') }),
    z.minimum(1, { error: () => t('workspace.members.form.minTtlHours') }),
    z.maximum(24 * 30),
  ),
})
type ShareLinkForm = z.infer<typeof shareLinkSchema>



const MEMBER_TABS = ['members', 'invitations', 'share-links'] as const
type MembersTab = (typeof MEMBER_TABS)[number]


function pageFromParams(v: string | null): number {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isInteger(n) && n >= 1 ? n : 1
}

export interface MembersPageProps {
  /** 无需 props：工作区上下文来自 PloykitProvider。保留 prop 通道便于产品扩展。 */
}

export function MembersPage(_props: MembersPageProps = {}) {
  const t = useT() // i18n（B 方案）：本页文案走 g5 分片字典，en 默认、zh 可选



  const [searchParams, setSearchParams] = useSearchParamsCompat()
  const tabParam = searchParams.get('tab')
  const tab: MembersTab =
    tabParam !== null && (MEMBER_TABS as readonly string[]).includes(tabParam)
      ? (tabParam as MembersTab)
      : 'members'
  const memberPage = pageFromParams(searchParams.get('mpage'))
  const invitePage = pageFromParams(searchParams.get('ipage'))
  const linkPage = pageFromParams(searchParams.get('lpage'))

  const setTab = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('tab', v)
      return next
    })
  }
  const setPageParam = (key: 'mpage' | 'ipage' | 'lpage', page: number) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set(key, String(page))
        return next
      },
      { replace: true },
    )
  }
  const {
    wsId, myRole, members, membersTotal, invitations, invitationsTotal,
    shareLinks, shareLinksTotal, loading, membersError, invitationsError,
    shareLinksError, refetchAll,
  } = useMembers({ members: memberPage, invitations: invitePage, shareLinks: linkPage })
  const mut = useMemberMutations()
  const confirm = useConfirm()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  
  
  const [transferTarget, setTransferTarget] = useState<PKMember | null>(null)

  const inviteForm = useZodForm<InviteForm>({
    schema: inviteSchema,
    defaultValues: { email: '', role: 'member' },
  })
  const linkForm = useZodForm<ShareLinkForm>({
    schema: shareLinkSchema,
    defaultValues: { role: 'member', max_uses: 10, ttl_hours: 72 },
  })

  if (!wsId) {
    return (
      <div>
        <PageHeader title={t('workspace.members.title')} />
        <PageEmpty label={t('workspace.members.needWorkspace')} />
      </div>
    )
  }
  if (loading) return <PageLoading label={t('workspace.members.loading')} />
  if (membersError) {
    return (
      <PageError
        message={apiErrorMessage(membersError, t('workspace.members.loadError'))}
        onRetry={() => refetchAll()}
      />
    )
  }

  
  
  const canManage = roleSatisfies(myRole ?? undefined, 'admin')
  
  
  const canTransfer = myRole === 'owner'

  

  const onRoleChange = async (m: PKMember, role: string) => {
    if (role === m.role) return
    try {
      await mut.updateRole.mutateAsync({ userId: m.user_id, role })
      toast.success(t('workspace.members.toastRoleChanged', { email: m.email, role: ROLE_LABEL[role] ?? role }))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('workspace.members.toastRoleChangeFailed')))
    }
  }

  const onRemove = async (m: PKMember) => {
    if (!(await confirm({
      title: t('workspace.members.removeMember'),
      description: t('workspace.members.removeConfirmDesc', { email: m.email }),
      confirmText: t('workspace.members.removeConfirmButton'), danger: true,
    }))) return
    try {
      await mut.removeMember.mutateAsync(m.user_id)
      toast.success(t('workspace.members.toastRemoved', { email: m.email }))
    } catch (e) {

      toast.error(apiErrorMessage(e, t('workspace.members.toastRemoveFailed')) + (isConflict(e) ? t('workspace.members.removeConflictHint') : ''))
    }
  }

  const onRevokeInvite = async (inv: PKInvitation) => {
    if (!(await confirm({
      title: t('workspace.members.revokeInviteTitle'),
      description: t('workspace.members.revokeInviteDesc', { email: inv.email }),
      confirmText: t('workspace.members.revokeButton'), danger: true,
    }))) return
    try {
      await mut.revokeInvitation.mutateAsync(inv.id)
      toast.success(t('workspace.members.toastInviteRevoked'))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('workspace.members.toastRevokeFailed')))
    }
  }

  const onRevokeLink = async (link: PKShareLink) => {
    if (!(await confirm({
      title: t('workspace.members.revokeLinkTitle'),
      description: t('workspace.members.revokeLinkDesc', { prefix: link.code_prefix }),
      confirmText: t('workspace.members.revokeButton'), danger: true,
    }))) return
    try {
      await mut.revokeShareLink.mutateAsync(link.id)
      toast.success(t('workspace.members.toastLinkRevoked'))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('workspace.members.toastRevokeFailed')))
    }
  }

  

  
  
  
  const onTransfer = async () => {
    const m = transferTarget
    if (!m) return
    try {
      await mut.transferOwnership.mutateAsync(m.user_id)
      toast.success(t('workspace.members.toastTransferDone', { email: m.email }))
      setTransferTarget(null)
    } catch (e) {
      toast.error(apiErrorMessage(e, t('workspace.members.toastTransferFailed')))
    }
  }

  const submitInvite = inviteForm.handleSubmit(async (values) => {
    try {
      await mut.invite.mutateAsync(values)
      toast.success(t('workspace.members.toastInviteSent', { email: values.email }))
      inviteForm.reset()
      setInviteOpen(false)
    } catch (e) {
      toast.error(apiErrorMessage(e, t('workspace.members.toastInviteFailed')))
    }
  })

  const submitLink = linkForm.handleSubmit(async (values) => {
    try {
      const res = await mut.createShareLink.mutateAsync(values)
      setSecret(res.code)
      linkForm.reset()
      setShareOpen(false)
    } catch (e) {
      toast.error(apiErrorMessage(e, t('workspace.members.toastLinkCreateFailed')))
    }
  })

  

  const memberColumns: Column<PKMember>[] = [
    {
      key: 'email',
      header: t('workspace.members.colEmail'),
      className: 'w-[28%]',
      render: (m) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{m.email}</p>
          {m.display_name && <p className="truncate text-xs text-muted-foreground">{m.display_name}</p>}
        </div>
      ),
    },
    {
      key: 'role',
      header: t('workspace.members.colRole'),
      className: 'w-[20%]',
      render: (m) =>
        m.role === 'owner' ? (
          <Badge variant="outline">{ROLE_LABEL.owner}</Badge>
        ) : canManage ? (
          <Select value={m.role} onValueChange={(v) => typeof v === 'string' && onRoleChange(m, v)}>
            <SelectTrigger size="sm" aria-label={t('workspace.members.roleChangeAria', { email: m.email })}>
              <SelectValue>{ROLE_LABEL[m.role] ?? m.role}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ASSIGNABLE_ROLES.map((r) => (
                <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="secondary">{ROLE_LABEL[m.role] ?? m.role}</Badge>
        ),
    },
    {
      key: 'created_at',
      header: t('workspace.members.colJoinedAt'),
      className: 'w-[22%]',
      render: (m) => <span className="text-muted-foreground">{formatDateTime(m.created_at)}</span>,
    },
    {
      key: 'actions',
      header: t('workspace.members.colActions'),
      className: 'w-[22%] text-right',
      render: (m) =>
        m.role !== 'owner' && (canManage || canTransfer) ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" aria-label={t('workspace.members.moreActionsAria', { email: m.email })} />}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {canTransfer && (
                <DropdownMenuItem
                  disabled={mut.transferOwnership.isPending}
                  onClick={() => setTransferTarget(m)}
                >
                  {t('workspace.members.transferOwnership')}
                </DropdownMenuItem>
              )}
              {canManage && (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={mut.removeMember.isPending}
                  onClick={() => onRemove(m)}
                >
                  {t('workspace.members.removeMember')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ]

  const invitationColumns: Column<PKInvitation>[] = [
    { key: 'email', header: t('workspace.members.colEmail'), render: (i) => <span className="font-medium">{i.email}</span> },
    { key: 'role', header: t('workspace.members.colRole'), render: (i) => <Badge variant="secondary">{ROLE_LABEL[i.role] ?? i.role}</Badge> },
    { key: 'status', header: t('workspace.members.colStatus'), render: (i) => <StatusBadge status={i.status} /> },
    {
      key: 'expires_at', header: t('workspace.members.colExpiresAt'),
      render: (i) => <span className="text-muted-foreground">{formatDateTime(i.expires_at)}</span>,
    },
    {
      key: 'actions', header: t('workspace.members.colActions'), className: 'text-right',
      render: (i) =>
        i.status === 'pending' && canManage ? (
          <Button size="sm" variant="outline" disabled={mut.revokeInvitation.isPending} onClick={() => onRevokeInvite(i)}>
            {t('workspace.members.revokeButton')}
          </Button>
        ) : null,
    },
  ]

  const shareLinkColumns: Column<PKShareLink>[] = [
    {
      key: 'code_prefix', header: t('workspace.members.colJoinCode'),
      render: (l) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{l.code_prefix}…</code>,
    },
    { key: 'role', header: t('workspace.members.colGrantedRole'), render: (l) => <Badge variant="secondary">{ROLE_LABEL[l.role] ?? l.role}</Badge> },
    {
      key: 'uses', header: t('workspace.members.colUses'),
      render: (l) => (
        <span className="tabular-nums">
          {l.uses} / {l.max_uses === -1 ? t('workspace.members.usesUnlimited') : l.max_uses}
        </span>
      ),
    },
    {
      key: 'expires_at', header: t('workspace.members.colExpiresAt'),
      render: (l) => <span className="text-muted-foreground">{formatDateTime(l.expires_at)}</span>,
    },
    {
      key: 'actions', header: t('workspace.members.colActions'), className: 'text-right',
      render: (l) =>
        canManage ? (
          <Button size="sm" variant="outline" disabled={mut.revokeShareLink.isPending} onClick={() => onRevokeLink(l)}>
            {t('workspace.members.revokeButton')}
          </Button>
        ) : null,
    },
  ]

  return (
    <div>
      <PageHeader
        title={t('workspace.members.title')}
        actions={
          canManage ? (
            <>
              <Button variant="outline" onClick={() => setShareOpen(true)}>
                <Link2 /> {t('workspace.members.createLink')}
              </Button>
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus /> {t('workspace.members.inviteMember')}
              </Button>
            </>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="members">{t('workspace.members.tabMembers', { count: membersTotal })}</TabsTrigger>
          <TabsTrigger value="invitations">{t('workspace.members.tabInvitations', { count: invitationsTotal })}</TabsTrigger>
          <TabsTrigger value="share-links">{t('workspace.members.tabShareLinks', { count: shareLinksTotal })}</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <DataTable
            columns={memberColumns}
            rows={members}
            rowKey={(m) => m.user_id}
            empty={<PageEmpty label={t('workspace.members.membersEmpty')} />}
            pagination={{
              page: memberPage,
              pageSize: LIST_PAGE_SIZE,
              total: membersTotal,
              onPageChange: (p) => setPageParam('mpage', p),
            }}
          />
        </TabsContent>

        <TabsContent value="invitations" className="mt-4">
          {invitationsError ? (

            <PageError
              message={apiErrorMessage(invitationsError, t('workspace.members.invitationsLoadError'))}
              onRetry={() => refetchAll()}
            />
          ) : (
            <DataTable
              columns={invitationColumns}
              rows={invitations}
              rowKey={(i) => i.id}
              empty={<PageEmpty label={t('workspace.members.invitationsEmpty')} hint={t('workspace.members.invitationsEmptyHint')} />}
              pagination={{
                page: invitePage,
                pageSize: LIST_PAGE_SIZE,
                total: invitationsTotal,
                onPageChange: (p) => setPageParam('ipage', p),
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="share-links" className="mt-4">
          {shareLinksError ? (

            <PageError
              message={apiErrorMessage(shareLinksError, t('workspace.members.linksLoadError'))}
              onRetry={() => refetchAll()}
            />
          ) : (
            <DataTable
              columns={shareLinkColumns}
              rows={shareLinks}
              rowKey={(l) => l.id}
              empty={

                <PageEmpty label={t('workspace.members.linksEmpty')} hint={t('workspace.members.linksEmptyHint')} />
              }
              pagination={{
                page: linkPage,
                pageSize: LIST_PAGE_SIZE,
                total: shareLinksTotal,
                onPageChange: (p) => setPageParam('lpage', p),
              }}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* 邀请对话框 */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspace.members.inviteMember')}</DialogTitle>
            <DialogDescription>{t('workspace.members.inviteDialogDesc')}</DialogDescription>
          </DialogHeader>
          {/* B7：noValidate 关掉浏览器原生校验气泡——错误文案唯一出口仍是下方
              zod（inviteSchema 兜底保留：字段级中文文案 + aria 关联不随浏览器
              语言漂移，jsdom/真实浏览器行为一致）。 */}
          <form className="space-y-4" onSubmit={submitInvite} noValidate>
            <FormField label={t('workspace.members.fieldEmail')} error={inviteForm.formState.errors.email?.message} htmlFor="invite-email">
              {/* B7：语义 type="email"——移动端唤出邮箱键盘、桌面端自动填充可识别；
                  输入法兼容：仅影响软键盘倾向 ASCII 布局，中文输入法粘贴/切英文
                  输入域名段不受影响；校验仍由 zod 统一裁决（见上 noValidate）。 */}
              <Input id="invite-email" type="email" autoComplete="email" placeholder="name@example.com" {...inviteForm.register('email')} />
            </FormField>
            <FormField label={t('workspace.members.fieldGrantRole')} error={inviteForm.formState.errors.role?.message}>
              <Select
                value={inviteForm.watch('role')}
                onValueChange={(v) => typeof v === 'string' && inviteForm.setValue('role', v as 'admin' | 'member')}
              >
                <SelectTrigger className="w-full" aria-label={t('workspace.members.inviteRoleAria')}>
                  <SelectValue>{ROLE_LABEL[inviteForm.watch('role')]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>{t('workspace.members.cancel')}</Button>
              <Button type="submit" disabled={mut.invite.isPending}>
                {mut.invite.isPending ? t('workspace.members.sending') : t('workspace.members.sendInvite')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 创建加入码对话框 */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspace.members.createLink')}</DialogTitle>
            <DialogDescription>
              {t('workspace.members.createLinkDesc')}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitLink}>
            <FormField label={t('workspace.members.fieldGrantRole')} error={linkForm.formState.errors.role?.message}>
              <Select
                value={linkForm.watch('role')}
                onValueChange={(v) => typeof v === 'string' && linkForm.setValue('role', v as 'admin' | 'member')}
              >
                <SelectTrigger className="w-full" aria-label={t('workspace.members.linkRoleAria')}>
                  <SelectValue>{ROLE_LABEL[linkForm.watch('role')]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={t('workspace.members.fieldMaxUses')} error={linkForm.formState.errors.max_uses?.message} htmlFor="link-max">
              <Input id="link-max" type="number" min={1} {...linkForm.register('max_uses', { valueAsNumber: true })} />
            </FormField>
            <FormField label={t('workspace.members.fieldTtl')} error={linkForm.formState.errors.ttl_hours?.message} htmlFor="link-ttl">
              <Input id="link-ttl" type="number" min={1} {...linkForm.register('ttl_hours', { valueAsNumber: true })} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShareOpen(false)}>{t('workspace.members.cancel')}</Button>
              <Button type="submit" disabled={mut.createShareLink.isPending}>
                {mut.createShareLink.isPending ? t('workspace.members.creating') : t('workspace.members.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 一次性兑换码 */}
      <SecretModal
        open={secret !== null}
        onOpenChange={(o) => !o && setSecret(null)}
        secretName={t('workspace.members.joinCode')}
        secretValue={secret ?? ''}
      />
      {transferTarget && (
        <ImpactConfirmation
          open
          onOpenChange={(o) => {
            if (!o) setTransferTarget(null)
          }}
          onConfirm={() => void onTransfer()}
          title={t('workspace.members.transferTitle', { email: transferTarget.email })}
          confirmText={t('workspace.members.transferConfirm')}
          danger
          impacts={[
            t('workspace.members.transferImpactOwner', { email: transferTarget.email }),
            t('workspace.members.transferImpactSelf'),
          ]}
        />
      )}
    </div>
  )
}

function isConflict(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'status' in e && (e as { status?: number }).status === 409
}

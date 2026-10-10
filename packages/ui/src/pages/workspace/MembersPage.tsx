
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { z } from 'zod'
import { UserPlus, Link2 } from 'lucide-react'
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
import { formatDateTime } from '../../lib/utils'
import { apiErrorMessage } from '../../lib/api-error'
import { roleSatisfies } from '@ploykit/hooks'



const inviteSchema = z.object({
  email: z.string().min(1, '请输入邮箱').email('邮箱格式不正确'),
  role: z.enum(['admin', 'member']),
})
type InviteForm = z.infer<typeof inviteSchema>

const shareLinkSchema = z.object({
  role: z.enum(['admin', 'member']),
  max_uses: z.number().int('须为整数').min(1, '至少 1 次').max(10000),
  ttl_hours: z.number().int('须为整数').min(1, '至少 1 小时').max(24 * 30),
})
type ShareLinkForm = z.infer<typeof shareLinkSchema>

const ROLE_LABEL: Record<string, string> = { owner: '所有者', admin: '管理员', member: '成员' }



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
  
  
  
  
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: MembersTab =
    tabParam !== null && (MEMBER_TABS as readonly string[]).includes(tabParam)
      ? (tabParam as MembersTab)
      : 'members'
  const memberPage = pageFromParams(searchParams.get('mpage'))
  const invitePage = pageFromParams(searchParams.get('ipage'))
  const linkPage = pageFromParams(searchParams.get('lpage'))
  
  const setTab = (t: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('tab', t)
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
        <PageHeader title="成员" description="管理当前工作区的成员、邀请与分享链接" />
        <PageEmpty label="请先创建并选择一个工作区" />
      </div>
    )
  }
  if (loading) return <PageLoading label="加载成员数据…" />
  if (membersError) {
    return (
      <PageError
        message={apiErrorMessage(membersError, '成员数据加载失败')}
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
      toast.success(`已将 ${m.email} 的角色改为 ${ROLE_LABEL[role] ?? role}`)
    } catch (e) {
      toast.error(apiErrorMessage(e, '角色变更失败'))
    }
  }

  const onRemove = async (m: PKMember) => {
    if (!(await confirm({
      title: '移除成员',
      description: `确定将 ${m.email} 移出本工作区？其将立即失去访问权限。`,
      confirmText: '移除', danger: true,
    }))) return
    try {
      await mut.removeMember.mutateAsync(m.user_id)
      toast.success('成员已移除')
    } catch (e) {
      
      toast.error(apiErrorMessage(e, '移除失败') + (isConflict(e) ? '（请先转移或删除工作区）' : ''))
    }
  }

  const onRevokeInvite = async (inv: PKInvitation) => {
    if (!(await confirm({
      title: '撤销邀请',
      description: `撤销发给 ${inv.email} 的邀请？对方将无法再接受。`,
      confirmText: '撤销', danger: true,
    }))) return
    try {
      await mut.revokeInvitation.mutateAsync(inv.id)
      toast.success('邀请已撤销')
    } catch (e) {
      toast.error(apiErrorMessage(e, '撤销失败'))
    }
  }

  const onRevokeLink = async (link: PKShareLink) => {
    if (!(await confirm({
      title: '撤销分享链接',
      description: `撤销前缀为 ${link.code_prefix}… 的分享链接？已兑换的成员不受影响。`,
      confirmText: '撤销', danger: true,
    }))) return
    try {
      await mut.revokeShareLink.mutateAsync(link.id)
      toast.success('分享链接已撤销')
    } catch (e) {
      toast.error(apiErrorMessage(e, '撤销失败'))
    }
  }

  

  
  
  
  const onTransfer = async () => {
    const m = transferTarget
    if (!m) return
    try {
      await mut.transferOwnership.mutateAsync(m.user_id)
      toast.success(`所有权已转让给 ${m.email}（你已降为成员）`)
      setTransferTarget(null)
    } catch (e) {
      toast.error(apiErrorMessage(e, '所有权转让失败'))
    }
  }

  const submitInvite = inviteForm.handleSubmit(async (values) => {
    try {
      await mut.invite.mutateAsync(values)
      toast.success(`邀请已发送至 ${values.email}`)
      inviteForm.reset()
      setInviteOpen(false)
    } catch (e) {
      toast.error(apiErrorMessage(e, '邀请发送失败'))
    }
  })

  const submitLink = linkForm.handleSubmit(async (values) => {
    try {
      const res = await mut.createShareLink.mutateAsync(values)
      toast.success('分享链接已创建')
      setSecret(res.code) 
      linkForm.reset()
      setShareOpen(false)
    } catch (e) {
      toast.error(apiErrorMessage(e, '创建分享链接失败'))
    }
  })

  

  const memberColumns: Column<PKMember>[] = [
    {
      key: 'email',
      header: '邮箱',
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
      header: '角色',
      className: 'w-[20%]',
      render: (m) =>
        m.role === 'owner' ? (
          <Badge variant="outline">{ROLE_LABEL.owner}</Badge>
        ) : canManage ? (
          <Select value={m.role} onValueChange={(v) => typeof v === 'string' && onRoleChange(m, v)}>
            <SelectTrigger size="sm" aria-label={`变更 ${m.email} 的角色`}>
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
      header: '加入时间',
      className: 'w-[22%]',
      render: (m) => <span className="text-muted-foreground">{formatDateTime(m.created_at)}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      className: 'w-[22%] text-right',
      render: (m) => (
        <div className="flex items-center justify-end gap-1.5">
          {canTransfer && m.role !== 'owner' && (
            <Button
              size="sm"
              variant="outline"
              disabled={mut.transferOwnership.isPending}
              title="目标升为 owner，你降为 member（单事务原子）"
              onClick={() => setTransferTarget(m)}
            >
              转让所有权
            </Button>
          )}
          {m.role !== 'owner' && canManage ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={mut.removeMember.isPending}
              onClick={() => onRemove(m)}
            >
              移除
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  const invitationColumns: Column<PKInvitation>[] = [
    { key: 'email', header: '邮箱', render: (i) => <span className="font-medium">{i.email}</span> },
    { key: 'role', header: '角色', render: (i) => <Badge variant="secondary">{ROLE_LABEL[i.role] ?? i.role}</Badge> },
    { key: 'status', header: '状态', render: (i) => <StatusBadge status={i.status} /> },
    {
      key: 'expires_at', header: '过期时间',
      render: (i) => <span className="text-muted-foreground">{formatDateTime(i.expires_at)}</span>,
    },
    {
      key: 'actions', header: '操作', className: 'text-right',
      render: (i) =>
        i.status === 'pending' && canManage ? (
          <Button size="sm" variant="outline" disabled={mut.revokeInvitation.isPending} onClick={() => onRevokeInvite(i)}>
            撤销
          </Button>
        ) : null,
    },
  ]

  const shareLinkColumns: Column<PKShareLink>[] = [
    {
      key: 'code_prefix', header: '兑换码前缀',
      render: (l) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{l.code_prefix}…</code>,
    },
    { key: 'role', header: '授予角色', render: (l) => <Badge variant="secondary">{ROLE_LABEL[l.role] ?? l.role}</Badge> },
    {
      key: 'uses', header: '兑换 / 上限',
      render: (l) => (
        <span className="tabular-nums">
          {l.uses} / {l.max_uses === -1 ? '不限' : l.max_uses}
        </span>
      ),
    },
    {
      key: 'expires_at', header: '过期时间',
      render: (l) => <span className="text-muted-foreground">{formatDateTime(l.expires_at)}</span>,
    },
    {
      key: 'actions', header: '操作', className: 'text-right',
      render: (l) =>
        canManage ? (
          <Button size="sm" variant="outline" disabled={mut.revokeShareLink.isPending} onClick={() => onRevokeLink(l)}>
            撤销
          </Button>
        ) : null,
    },
  ]

  return (
    <div>
      <PageHeader
        title="成员"
        description="管理当前工作区的成员、邀请与分享链接"
        actions={
          canManage ? (
            <>
              <Button variant="outline" onClick={() => setShareOpen(true)}>
                <Link2 /> 创建分享链接
              </Button>
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus /> 邀请成员
              </Button>
            </>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="members">成员（{membersTotal}）</TabsTrigger>
          <TabsTrigger value="invitations">邀请（{invitationsTotal}）</TabsTrigger>
          <TabsTrigger value="share-links">分享链接（{shareLinksTotal}）</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <DataTable
            columns={memberColumns}
            rows={members}
            rowKey={(m) => m.user_id}
            empty={<PageEmpty label="暂无成员" />}
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
              message={apiErrorMessage(invitationsError, '邀请列表加载失败')}
              onRetry={() => refetchAll()}
            />
          ) : (
            <DataTable
              columns={invitationColumns}
              rows={invitations}
              rowKey={(i) => i.id}
              empty={<PageEmpty label="暂无邀请" hint="点击右上角“邀请成员”发送新邀请" />}
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
              message={apiErrorMessage(shareLinksError, '分享链接加载失败')}
              onRetry={() => refetchAll()}
            />
          ) : (
            <DataTable
              columns={shareLinkColumns}
              rows={shareLinks}
              rowKey={(l) => l.id}
              empty={
                
                <PageEmpty label="暂无分享链接" hint="分享链接可让用户自助加入工作区；点击右上角“创建分享链接”生成兑换码" />
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
            <DialogTitle>邀请成员</DialogTitle>
            <DialogDescription>向对方邮箱发送加入本工作区的邀请。</DialogDescription>
          </DialogHeader>
          {/* B7：noValidate 关掉浏览器原生校验气泡——错误文案唯一出口仍是下方
              zod（inviteSchema 兜底保留：字段级中文文案 + aria 关联不随浏览器
              语言漂移，jsdom/真实浏览器行为一致）。 */}
          <form className="space-y-4" onSubmit={submitInvite} noValidate>
            <FormField label="邮箱" error={inviteForm.formState.errors.email?.message} htmlFor="invite-email">
              {/* B7：语义 type="email"——移动端唤出邮箱键盘、桌面端自动填充可识别；
                  输入法兼容：仅影响软键盘倾向 ASCII 布局，中文输入法粘贴/切英文
                  输入域名段不受影响；校验仍由 zod 统一裁决（见上 noValidate）。 */}
              <Input id="invite-email" type="email" autoComplete="email" placeholder="name@example.com" {...inviteForm.register('email')} />
            </FormField>
            <FormField label="角色" error={inviteForm.formState.errors.role?.message}>
              <Select
                value={inviteForm.watch('role')}
                onValueChange={(v) => typeof v === 'string' && inviteForm.setValue('role', v as 'admin' | 'member')}
              >
                <SelectTrigger className="w-full" aria-label="邀请角色">
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
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>取消</Button>
              <Button type="submit" disabled={mut.invite.isPending}>
                {mut.invite.isPending ? '发送中…' : '发送邀请'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 创建分享链接对话框 */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建分享链接</DialogTitle>
            <DialogDescription>
              生成可分享的兑换码；持有者可按所选角色自助加入工作区。完整兑换码仅创建时展示一次。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitLink}>
            <FormField label="授予角色" error={linkForm.formState.errors.role?.message}>
              <Select
                value={linkForm.watch('role')}
                onValueChange={(v) => typeof v === 'string' && linkForm.setValue('role', v as 'admin' | 'member')}
              >
                <SelectTrigger className="w-full" aria-label="分享链接角色">
                  <SelectValue>{ROLE_LABEL[linkForm.watch('role')]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="最大兑换次数" error={linkForm.formState.errors.max_uses?.message} htmlFor="link-max">
              <Input id="link-max" type="number" min={1} {...linkForm.register('max_uses', { valueAsNumber: true })} />
            </FormField>
            <FormField label="有效期（小时）" error={linkForm.formState.errors.ttl_hours?.message} htmlFor="link-ttl">
              <Input id="link-ttl" type="number" min={1} {...linkForm.register('ttl_hours', { valueAsNumber: true })} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShareOpen(false)}>取消</Button>
              <Button type="submit" disabled={mut.createShareLink.isPending}>
                {mut.createShareLink.isPending ? '创建中…' : '创建'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 一次性兑换码 */}
      <SecretModal
        open={secret !== null}
        onOpenChange={(o) => !o && setSecret(null)}
        secretName="分享链接兑换码"
        secretValue={secret ?? ''}
      />
      {transferTarget && (
        <ImpactConfirmation
          open
          onOpenChange={(o) => {
            if (!o) setTransferTarget(null)
          }}
          onConfirm={() => void onTransfer()}
          title={`转让所有权给 ${transferTarget.email}`}
          confirmText="确认转让"
          danger
          impacts={[
            `${transferTarget.email} 将成为新 owner（获得工作区最高权与计费控制权）`,
            '你将降为 member（普通成员权限；转让单事务原子，失败不产生中间态）',
            '目标须是本工作区活跃成员且账号未禁用；钩子拦截/非法目标返回 409',
          ]}
        />
      )}
    </div>
  )
}

function isConflict(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'status' in e && (e as { status?: number }).status === 409
}

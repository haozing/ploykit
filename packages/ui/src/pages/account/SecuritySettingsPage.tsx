
import { useState } from 'react'
import { z } from 'zod'
import { PageHeader, PageError } from '../../components/Page'
import { SettingsCard } from '../../components/SettingsCard'
import { FormField } from '../../components/FormField'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { DataTable, type Column } from '../../components/DataTable'
import { ImpactConfirmation } from '../../components/SecretModal'
import { useConfirm } from '../../components/ConfirmDialog'
import { toast } from '../../components/toast'
import { useApi } from '@ploykit/hooks'
import { useAuth } from '@ploykit/hooks'
import { useZodForm } from '@ploykit/hooks'
import { useSessions, useRevokeSession, useRevokeAllSessions, type SessionInfo } from '@ploykit/hooks'
import { passwordSchema } from '../auth/RegisterPage'
import { apiErrorMessage } from '../../lib/api-error'
import { formatDateTime, shortID } from '../../lib/utils'

const changePwSchema = z
  .object({
    old_password: z.string().min(1, '请输入当前密码'),
    new_password: passwordSchema,
  })
  // B4（ui-audit-10pages §4.2，S3）：new==old 客户端拦截——相同值提交后端会
  // 判定通过并"成功"改密，顺带静默吊销全部会话（服务端无 new==old 校验，
  // 半边 ➡️U1 identity 归属）。跨字段校验须挂对象级 refine（字段级拿不到 old）；
  // zod 语义：字段规则全过才跑 refine，old 为空时不会叠加误导性报错。
  .superRefine((v, ctx) => {
    if (v.old_password !== '' && v.new_password === v.old_password) {
      ctx.addIssue({
        code: 'custom',
        path: ['new_password'],
        message: '新密码不能与当前密码相同',
      })
    }
  })
type ChangePwForm = z.infer<typeof changePwSchema>

function truncate(s: string, max = 32): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

export function SecuritySettingsPage() {
  const api = useApi()
  const { refresh, logout } = useAuth()
  const confirm = useConfirm()
  const { sessions, loading, error, refetch } = useSessions()
  const { revoke } = useRevokeSession()
  const { revokeAll } = useRevokeAllSessions()

  const [saving, setSaving] = useState(false)
  const [revokingAll, setRevokingAll] = useState(false)
  const [confirmAllOpen, setConfirmAllOpen] = useState(false)

  const form = useZodForm<ChangePwForm>({
    schema: changePwSchema,
    defaultValues: { old_password: '', new_password: '' },
  })

  const handleChangePw = form.handleSubmit(async (values) => {
    setSaving(true)
    try {
      await api.post('/auth/change-password', {
        old_password: values.old_password,
        new_password: values.new_password,
      })
      toast.success('密码已修改，其他设备可能需要重新登录')
      form.reset()
      await refresh() 
    } catch (e) {
      
      
      
      toast.error(apiErrorMessage(e, '修改失败'))
    } finally {
      setSaving(false)
    }
  })

  const handleRevoke = async (s: SessionInfo) => {
    const ok = await confirm({
      title: '吊销此会话？',
      description: s.current ? '这是当前设备，吊销后需要重新登录。' : truncate(s.user_agent),
      confirmText: '吊销',
      danger: true,
    })
    if (!ok) return
    try {
      await revoke(s.id)
      if (s.current) {
        
        
        
        toast.success('已吊销当前会话，即将返回登录页')
        await logout()
        window.location.href = '/login'
        return
      }
      toast.success('会话已吊销')
    } catch (e) {
      toast.error(apiErrorMessage(e, '吊销失败'))
    }
  }

  const handleRevokeAll = async () => {
    setRevokingAll(true)
    try {
      await revokeAll() 
      toast.success('已吊销全部会话')
      window.location.href = '/login'
    } catch (e) {
      toast.error(apiErrorMessage(e, '吊销失败'))
      setRevokingAll(false)
    }
  }

  const columns: Column<SessionInfo>[] = [
    {
      key: 'user_agent', header: '设备',
      
      
      
      render: (s) => (
        <span title={s.user_agent} className="text-muted-foreground inline-block max-w-64 truncate">{truncate(s.user_agent)}</span>
      ),
    },
    {
      key: 'ip_hash', header: 'IP（哈希）',
      render: (s) => <span title={s.ip_hash} className="font-mono text-xs">{shortID(s.ip_hash, 10)}</span>,
    },
    { key: 'last_seen_at', header: '最近活跃', render: (s) => formatDateTime(s.last_seen_at) },
    { key: 'expires_at', header: '过期时间', render: (s) => formatDateTime(s.expires_at) },
    {
      key: 'current', header: '当前',
      
      render: (s) =>
        s.current === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : s.current ? (
          <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">当前设备</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (s) => (
        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleRevoke(s)}>
          吊销
        </Button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="账户安全" description="修改密码并管理已登录设备" />

      <SettingsCard
        title="修改密码" description="修改后其他会话将失效，需要重新登录"
        cta={<Button type="submit" form="security-pw-form" disabled={saving}>{saving ? '提交中…' : '修改密码'}</Button>}
      >
        <form id="security-pw-form" onSubmit={handleChangePw} className="max-w-xl space-y-4">
          <FormField label="当前密码" error={form.formState.errors.old_password?.message} htmlFor="sec-old">
            <Input id="sec-old" type="password" autoComplete="current-password" {...form.register('old_password')} />
          </FormField>
          <FormField label="新密码" error={form.formState.errors.new_password?.message} htmlFor="sec-new">
            <Input id="sec-new" type="password" placeholder="至少 10 位，含三类字符"
              autoComplete="new-password" {...form.register('new_password')} />
          </FormField>
        </form>
      </SettingsCard>

      <SettingsCard
        title="活跃会话"
        description="最近登录过你账号的设备；可疑会话请立即吊销"
        cta={
          <Button variant="destructive" size="sm" disabled={revokingAll} onClick={() => setConfirmAllOpen(true)}>
            全部吊销
          </Button>
        }
      >
        {error ? (
          <PageError message={apiErrorMessage(error, '会话列表加载失败')} onRetry={() => refetch()} />
        ) : (
          <DataTable
            columns={columns}
            rows={sessions}
            rowKey={(s) => s.id}
            loading={loading}
            empty={<div className="py-8 text-center text-sm text-muted-foreground">暂无活跃会话</div>}
          />
        )}
      </SettingsCard>

      <ImpactConfirmation
        open={confirmAllOpen}
        onOpenChange={setConfirmAllOpen}
        onConfirm={handleRevokeAll}
        title="吊销全部会话？"
        confirmText="全部吊销"
        danger
        impacts={[
          '所有设备（含当前设备）立即退出登录',
          '会话 cookie 被清除，页面将跳转登录页',
          '个人访问令牌（PAT）不受影响，仍需单独吊销',
        ]}
      />
    </div>
  )
}

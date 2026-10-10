
import { useState } from 'react'
import { z } from 'zod'
import { PageHeader, PageLoading, PageError } from '../../components/Page'
import { SettingsCard } from '../../components/SettingsCard'
import { FormField } from '../../components/FormField'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'
import { ImpactConfirmation } from '../../components/SecretModal'
import { toast } from '../../components/toast'
import { apiErrorMessage } from '../../lib/api-error'
import { useApi } from '@ploykit/hooks'
import { useAuth } from '@ploykit/hooks'
import { useZodForm } from '@ploykit/hooks'
import type { PKUser } from '@ploykit/hooks'



const profileSchema = z.object({
  display_name: z.string().trim().min(1, '请输入昵称').max(100, '昵称最多 100 字符'),
  
  avatar_url: z.string()
    .refine((v) => v === '' || /^https?:\/\//.test(v), '头像链接需以 http(s):// 开头')
    .refine((v) => v === '' || v.length <= 2048, '头像链接最多 2048 字符'),
})
type ProfileForm = z.infer<typeof profileSchema>

export interface ProfileSettingsPageProps {
  
  onDeleted?: () => void
}

export function ProfileSettingsPage({ onDeleted }: ProfileSettingsPageProps) {
  const { user, loading, refresh, logout } = useAuth()
  const api = useApi()
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const form = useZodForm<ProfileForm>({
    schema: profileSchema,
    defaultValues: { display_name: user?.display_name ?? '', avatar_url: user?.avatar_url ?? '' },
    values: user
      ? { display_name: user.display_name, avatar_url: user.avatar_url ?? '' }
      : undefined, // 用户数据到达后同步进表单（保留已输入内容的 RHF 回退语义）
  })

  if (loading) return <PageLoading label="加载账号信息…" />
  if (!user) {
    return <PageError message="未登录或会话已过期，请重新登录" onRetry={() => refresh()} />
  }

  const handleSave = form.handleSubmit(async (values) => {
    setSaving(true)
    try {
      await api.patch<PKUser>('/auth/me', {
        display_name: values.display_name,
        avatar_url: values.avatar_url,
      })
      await refresh() 
      toast.success('资料已更新')
    } catch (e) {
      
      toast.error(apiErrorMessage(e, '保存失败'))
    } finally {
      setSaving(false)
    }
  })

  const handleResend = async () => {
    setSending(true)
    try {
      await api.post('/auth/send-verification') 
      toast.success('验证邮件已发送，请查收')
    } catch (e) {
      toast.error(apiErrorMessage(e, '发送失败'))
    } finally {
      setSending(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.delete('/auth/me') 
      if (onDeleted) onDeleted()
      else {
        await logout()
        window.location.href = '/login'
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, '注销失败'))
    } finally {
      setDeleting(false)
    }
  }

  const emailReadyToDelete = confirmEmail.trim().toLowerCase() === user.email.toLowerCase()

  return (
    <div>
      <PageHeader title="个人资料" description="管理昵称、头像等账号资料" />

      <SettingsCard
        title="资料" description="对外展示的昵称与头像"
        cta={<Button type="submit" form="profile-form" disabled={saving}>{saving ? '保存中…' : '保存'}</Button>}
      >
        <form id="profile-form" onSubmit={handleSave} className="max-w-xl space-y-4">
          <FormField
            label="昵称" required
            error={form.formState.errors.display_name?.message} htmlFor="profile-name"
          >
            <Input id="profile-name" maxLength={100} placeholder="怎么称呼你" {...form.register('display_name')} />
          </FormField>
          <FormField
            label="头像链接"
            error={form.formState.errors.avatar_url?.message} htmlFor="profile-avatar"
            description="可选；需 http(s):// 开头、最多 2048 字符。外部图片可能被内容安全策略拦截，无法加载时显示默认头像"
          >
            <Input id="profile-avatar" maxLength={2048} placeholder="https://…（可选）" {...form.register('avatar_url')} />
          </FormField>
        </form>

        <div className="mt-6 flex flex-row items-center justify-between gap-4 rounded-lg border p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">登录邮箱</p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground" data-testid="profile-email">
              {user.email}
            </p>
            {/* B3：只读现实如实说明——此前页头承诺"管理登录邮箱"却无修改入口 */}
            <p className="mt-1 text-xs text-muted-foreground">用于登录与接收通知，暂不支持自助修改</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {user.email_verified ? (
              <Badge variant="secondary" className="bg-(--success)/10 text-(--success) border-(--success)/30">
                已验证
              </Badge>
            ) : (
              <>
                <Badge variant="outline" className="text-(--warning) border-(--warning)/40 bg-(--warning)/15">未验证</Badge>
                <Button variant="outline" size="sm" onClick={handleResend} disabled={sending}>
                  {sending ? '发送中…' : '重新发送验证邮件'}
                </Button>
              </>
            )}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        danger title="删除账号" description="注销后账号进入删除状态，无法恢复"
        cta={
          <Button
            variant="destructive" disabled={!emailReadyToDelete || deleting}
            onClick={() => setConfirmOpen(true)}
          >
            删除账号
          </Button>
        }
      >
        <div className="max-w-xl space-y-4">
          <FormField label="输入登录邮箱以确认" htmlFor="profile-delete-email">
            <Input
              id="profile-delete-email" placeholder={user.email} value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
            />
          </FormField>
        </div>
      </SettingsCard>

      <ImpactConfirmation
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleDelete}
        title="确认删除账号？"
        confirmText="永久删除"
        danger
        impacts={[
          '账号进入 deleted 状态，邮箱被释放（可用同邮箱重新注册）',
          '所有会话立即失效并吊销全部个人访问令牌（PAT）',
          '昵称、头像等资料被清空，操作不可恢复',
        ]}
      />
    </div>
  )
}

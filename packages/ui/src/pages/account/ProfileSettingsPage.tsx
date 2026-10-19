
import { useState } from 'react'
import { z } from 'zod'
import { PageHeader, PageLoading, PageError } from '../../components/Page'
import { SettingsCard } from '../../components/SettingsCard'
import { FormField } from '../../components/FormField'
import { Alert, AlertDescription, AlertAction } from '../../components/ui/alert'
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '../../components/ui/item'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'
import { Spinner } from '../../components/ui/spinner'
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
      toast.error(apiErrorMessage(e, '删除失败'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <PageHeader title="个人资料" />

      <SettingsCard
        title="基本资料"
        cta={<Button type="submit" form="profile-form" disabled={saving}>{saving ? (<><Spinner aria-hidden="true" />保存中…</>) : '保存'}</Button>}
      >
        <form id="profile-form" onSubmit={handleSave} className="max-w-xl space-y-4">
          <FormField
            label="昵称" required
            error={form.formState.errors.display_name?.message} htmlFor="profile-name"
          >
            <Input id="profile-name" maxLength={100} placeholder="怎么称呼你" {...form.register('display_name')} />
          </FormField>
          <FormField
            label="头像链接（可选）"
            error={form.formState.errors.avatar_url?.message} htmlFor="profile-avatar"
            description="填写以 https:// 开头的图片地址；部分网站限制外链，图片无法加载时将显示默认头像"
          >
            <Input id="profile-avatar" maxLength={2048} placeholder="https://…" {...form.register('avatar_url')} />
          </FormField>
        </form>

        <Item variant="outline" className="mt-6">
          <ItemContent className="min-w-0">
            <ItemTitle>登录邮箱</ItemTitle>
            <ItemDescription className="truncate" data-testid="profile-email">
              {user.email}
            </ItemDescription>
            {/* B3：只读现实如实说明——此前页头承诺"管理登录邮箱"却无修改入口 */}
            <ItemDescription className="text-xs">用于登录与接收通知，暂无法在此修改</ItemDescription>
          </ItemContent>
          {user.email_verified && (
            <ItemActions>
              <Badge variant="secondary" className="bg-(--success)/10 text-(--success) border-(--success)/30">
                已验证
              </Badge>
            </ItemActions>
          )}
        </Item>

        {!user.email_verified && (
          <Alert className="mt-2 border-(--warning)/40 bg-(--warning)/15">
            <AlertDescription className="text-(--warning)/90">登录邮箱尚未验证</AlertDescription>
            <AlertAction>
              <Button variant="outline" size="sm" onClick={handleResend} disabled={sending}>
                {sending ? (<><Spinner aria-hidden="true" />发送中…</>) : '重新发送验证邮件'}
              </Button>
            </AlertAction>
          </Alert>
        )}
      </SettingsCard>

      <SettingsCard
        danger title="删除账号" description="删除后账号将被停用，所有数据无法恢复"
        cta={
          <Button
            variant="destructive" disabled={deleting}
            onClick={() => setConfirmOpen(true)}
          >
            删除账号
          </Button>
        }
      >
        {null}
      </SettingsCard>

      <ImpactConfirmation
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleDelete}
        title="确认删除账号？"
        confirmText="永久删除"
        danger
        impacts={[
          '账号将被删除，该邮箱之后可用于重新注册',
          '所有登录会话立即失效，全部个人访问令牌（PAT）被吊销',
          '昵称、头像等账号资料将被清空',
        ]}
      />
    </div>
  )
}

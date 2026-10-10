
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { PageHeader, PageError } from '../../components/Page'
import { SettingsCard } from '../../components/SettingsCard'
import { FormField } from '../../components/FormField'
import { ImpactConfirmation } from '../../components/SecretModal'
import { useConfirm } from '../../components/ConfirmDialog'
import { toast } from '../../components/toast'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useApi } from '@ploykit/hooks'
import { useWorkspace } from '@ploykit/hooks'
import { useZodForm } from '@ploykit/hooks'
import { queryKeys, type PKWorkspace } from '@ploykit/hooks'
import { apiErrorMessage } from '../../lib/api-error'
import { roleSatisfies } from '@ploykit/hooks'



const renameSchema = z.object({
  name: z.string().trim().min(1, '请输入工作区名称').max(64, '名称最多 64 字符'),
})
type RenameForm = z.infer<typeof renameSchema>

export interface WorkspaceGeneralPageProps {
  
  exitTo?: string
}

export function WorkspaceGeneralPage({ exitTo = '/app' }: WorkspaceGeneralPageProps = {}) {
  const { current, clear } = useWorkspace()
  const api = useApi()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const ws = current
  const form = useZodForm<RenameForm>({
    schema: renameSchema,
    defaultValues: { name: ws?.name ?? '' },
    values: ws ? { name: ws.name } : undefined, // 工作区数据到达后同步进表单
  })

  if (!ws) {
    return (
      <div>
        <PageHeader title="工作区概况" />
        <PageError message="工作区不存在或尚未选择" onRetry={() => qc.invalidateQueries({ queryKey: queryKeys.workspaceList })} />
      </div>
    )
  }

  
  
  const canRename = roleSatisfies(ws.role, 'admin')
  const canDelete = roleSatisfies(ws.role, 'owner')

  const refreshList = async () => {
    await qc.invalidateQueries({ queryKey: queryKeys.workspace })
  }

  const handleRename = form.handleSubmit(async (values) => {
    setSaving(true)
    try {
      await api.patch<PKWorkspace>(`/api/workspaces/${ws.id}`, { name: values.name })
      await refreshList()
      toast.success('工作区名称已更新')
    } catch (e) {
      toast.error(apiErrorMessage(e, '重命名失败'))
    } finally {
      setSaving(false)
    }
  })

  const afterExit = async () => {
    clear()
    await refreshList()
    navigate(exitTo)
  }

  const handleLeave = async () => {
    if (!(await confirm({
      title: '退出工作区',
      description: `退出后将失去「${ws.name}」的访问权限；你创建的数据会保留在工作区内。`,
      confirmText: '退出', danger: true,
    }))) return
    try {
      await api.post(`/api/workspaces/${ws.id}/leave`)
      toast.success('已退出工作区')
      await afterExit()
    } catch (e) {
      
      
      
      toast.error(is409(e)
        ? '最后一个所有者不能离开工作区，请先转移所有权或删除工作区'
        : apiErrorMessage(e, '退出失败'))
    }
  }

  const handleDelete = async () => {
    try {
      await api.delete(`/api/workspaces/${ws.id}`)
      toast.success('工作区已删除')
      await afterExit()
    } catch (e) {
      
      toast.error(apiErrorMessage(e, '删除失败'))
    }
  }

  return (
    <div>
      <PageHeader title="工作区概况" description={`工作区 ${ws.name}（${ws.slug}）的基础设置`} />

      <SettingsCard
        title="基础信息"
        description="工作区名称对成员可见；slug 是 URL 标识，创建后不可修改。"
      >
        <form className="max-w-md space-y-4" onSubmit={handleRename}>
          <FormField label="工作区名称" error={form.formState.errors.name?.message} htmlFor="ws-name">
            <Input id="ws-name" disabled={!canRename} {...form.register('name')} />
          </FormField>
          <FormField label="Slug（只读）" htmlFor="ws-slug">
            <Input id="ws-slug" value={ws.slug} readOnly disabled />
          </FormField>
          {canRename && (
            <Button type="submit" disabled={saving}>{saving ? '保存中…' : '保存修改'}</Button>
          )}
        </form>
      </SettingsCard>

      <SettingsCard danger title="危险区" description="以下操作影响全部成员，请谨慎执行。">
        <div className="space-y-4">
          <div className="flex flex-row items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">退出工作区</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                退出后你将不再是「{ws.name}」的成员。最后一位 owner 无法退出。
              </p>
            </div>
            <Button variant="outline" onClick={handleLeave}>退出工作区</Button>
          </div>

          {canDelete && (
            <div className="flex flex-row items-center justify-between gap-4 rounded-lg border border-destructive/40 p-4">
              <div>
                <p className="text-sm font-medium text-destructive">删除工作区</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  硬删除工作区及其全部数据，操作不可恢复。
                </p>
              </div>
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>删除工作区</Button>
            </div>
          )}
        </div>
      </SettingsCard>

      <ImpactConfirmation
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title={`删除工作区「${ws.name}」`}
        impacts={[
          '工作区全部数据将被永久删除，且不可恢复',
          '所有成员立即失去访问权限',
          '未撤销的邀请与分享链接同时失效',
          '历史审计记录将保留（合规要求），但不再关联可访问的工作区',
        ]}
        confirmText="永久删除"
        danger
      />
    </div>
  )
}

function is409(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'status' in e && (e as { status?: number }).status === 409
}


import { useState } from 'react'
import { useNavigate } from '../../router'
import { useQueryClient } from '@tanstack/react-query'
import * as z from 'zod/mini'
import { PageHeader, PageError } from '../../components/Page'
import { SettingsCard } from '../../components/SettingsCard'
import { FormField } from '../../components/FormField'
import { ImpactConfirmation } from '../../components/SecretModal'
import { useConfirm } from '../../components/ConfirmDialog'
import { toast } from '../../components/toast'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Item, ItemContent, ItemDescription, ItemActions, ItemTitle } from '../../components/ui/item'
import { useApi } from '@ploykit/hooks'
import { useWorkspace } from '@ploykit/hooks'
import { useZodForm } from '@ploykit/hooks'
import { queryKeys, type PKWorkspace } from '@ploykit/hooks'
import { apiErrorMessage } from '../../lib/api-error'
import { roleSatisfies } from '@ploykit/hooks'
import { useT, t as moduleT } from '../../i18n'



export const renameSchema = z.object({
  name: z.string().check(
    z.trim(),
    // g6 i18n：校验文案经模块级 t() 在校验时解析（error 回调惰性求值，随 setUiLang 变化）
    z.minLength(1, { error: () => moduleT('workspace.workspaceGeneral.nameRequired') }),
    z.maxLength(64, { error: () => moduleT('workspace.workspaceGeneral.nameMaxLength') }),
  ),
})
type RenameForm = z.infer<typeof renameSchema>

export interface WorkspaceGeneralPageProps {
  
  exitTo?: string
}

export function WorkspaceGeneralPage({ exitTo = '/app' }: WorkspaceGeneralPageProps = {}) {
  const t = useT()
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
        <PageHeader title={t('workspace.workspaceGeneral.title')} />
        <PageError message={t('workspace.workspaceGeneral.notFound')} onRetry={() => qc.invalidateQueries({ queryKey: queryKeys.workspaceList })} />
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
      toast.success(t('workspace.workspaceGeneral.renamed'))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('workspace.workspaceGeneral.renameFailed')))
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
      title: t('workspace.workspaceGeneral.leaveTitle'),
      description: t('workspace.workspaceGeneral.leaveConfirmDesc', { name: ws.name }),
      confirmText: t('workspace.workspaceGeneral.leaveAction'), danger: true,
    }))) return
    try {
      await api.post(`/api/workspaces/${ws.id}/leave`)
      toast.success(t('workspace.workspaceGeneral.leftToast'))
      await afterExit()
    } catch (e) {



      toast.error(is409(e)
        ? t('workspace.workspaceGeneral.lastOwner')
        : apiErrorMessage(e, t('workspace.workspaceGeneral.leaveFailed')))
    }
  }

  const handleDelete = async () => {
    try {
      await api.delete(`/api/workspaces/${ws.id}`)
      toast.success(t('workspace.workspaceGeneral.deletedToast'))
      await afterExit()
    } catch (e) {

      toast.error(apiErrorMessage(e, t('workspace.workspaceGeneral.deleteFailed')))
    }
  }

  return (
    <div>
      <PageHeader title={t('workspace.workspaceGeneral.title')} />

      <SettingsCard title={t('workspace.workspaceGeneral.basicInfo')}>
        <form className="max-w-md space-y-4" onSubmit={handleRename}>
          <FormField label={t('workspace.workspaceGeneral.nameLabel')} error={form.formState.errors.name?.message} htmlFor="ws-name">
            <Input id="ws-name" disabled={!canRename} {...form.register('name')} />
          </FormField>
          <FormField label={t('workspace.workspaceGeneral.slugReadonly')} htmlFor="ws-slug">
            <Input id="ws-slug" value={ws.slug} readOnly disabled />
          </FormField>
          {canRename && (
            <Button type="submit" disabled={saving}>
              {saving ? t('workspace.workspaceGeneral.saving') : t('workspace.workspaceGeneral.saveChanges')}
            </Button>
          )}
        </form>
      </SettingsCard>

      <SettingsCard danger title={t('workspace.workspaceGeneral.dangerZone')} description={t('workspace.workspaceGeneral.dangerZoneDesc')}>
        <div className="space-y-4">
          <Item variant="outline" className="justify-between gap-4 p-4">
            <ItemContent>
              <ItemTitle>{t('workspace.workspaceGeneral.leaveTitle')}</ItemTitle>
              <ItemDescription>
                {t('workspace.workspaceGeneral.leaveDesc', { name: ws.name })}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button variant="outline" onClick={handleLeave}>{t('workspace.workspaceGeneral.leaveTitle')}</Button>
            </ItemActions>
          </Item>

          {canDelete && (
            <Item variant="outline" className="justify-between gap-4 border-destructive/40 p-4">
              <ItemContent>
                <ItemTitle className="text-destructive">{t('workspace.workspaceGeneral.deleteTitle')}</ItemTitle>
                <ItemDescription>
                  {t('workspace.workspaceGeneral.deleteDesc')}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="destructive" onClick={() => setDeleteOpen(true)}>{t('workspace.workspaceGeneral.deleteTitle')}</Button>
              </ItemActions>
            </Item>
          )}
        </div>
      </SettingsCard>

      <ImpactConfirmation
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title={t('workspace.workspaceGeneral.deleteConfirmTitle', { name: ws.name })}
        impacts={[
          t('workspace.workspaceGeneral.impactData'),
          t('workspace.workspaceGeneral.impactMembers'),
          t('workspace.workspaceGeneral.impactInvites'),
          t('workspace.workspaceGeneral.impactAudit'),
        ]}
        confirmText={t('workspace.workspaceGeneral.deletePermanently')}
        danger
      />
    </div>
  )
}

function is409(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'status' in e && (e as { status?: number }).status === 409
}

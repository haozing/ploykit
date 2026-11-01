
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { t, useT } from '../../i18n'
import * as z from 'zod/mini'
import {
  PageHeader, PageLoading, PageError, PageEmpty,
} from '../../components/Page'
import { DataTable, type Column } from '../../components/DataTable'
import { FormField } from '../../components/FormField'
import { CronInput, describeCron } from '../../components/CronInput'
import { toast } from '../../components/toast'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { useApi } from '@ploykit/hooks'
import { useWorkspace } from '@ploykit/hooks'
import { useZodForm } from '@ploykit/hooks'
import { useConfirm } from '../../components/ConfirmDialog'
import { browserTzLabel, formatDateTimeTz } from '../../lib/utils'
import { apiErrorMessage } from '../../lib/api-error'



interface SchedulePlan {
  id: string
  workspace_id: string
  kind: string
  cron_expr: string
  timezone: string
  next_fire_at: string
  misfire: 'skip' | 'once'
  last_fired_at?: string | null
  created_at: string
  enabled: boolean
}

/** misfire 键 → i18n key（渲染处经 t() 取文案；未知键回退显示原始值）。 */
export const MISFIRE_LABEL: Record<string, string> = {
  skip: 'workspace.schedules.misfireSkip',
  once: 'workspace.schedules.misfireOnce',
}


function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// i18n（B 方案）：校验文案走 error 函数——safeParse 时才取字典，语言随 setUiLang 生效。
export const createSchema = z.object({
  kind: z.string().check(
    z.trim(),
    z.minLength(1, { error: () => t('workspace.schedules.form.kindRequired') }),
  ),
  cron_expr: z.string().check(
    z.trim(),
    z.regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, { error: () => t('workspace.schedules.form.cronFiveFields') }),
  ),
  timezone: z.string().check(z.minLength(1, { error: () => t('workspace.schedules.form.tzRequired') })),
  misfire: z.enum(['skip', 'once']),
})
type CreateForm = z.infer<typeof createSchema>

export interface SchedulesPageProps {}

export function SchedulesPage(_props: SchedulesPageProps = {}) {
  const t = useT() // i18n（B 方案）：本页文案走 g5 分片字典，en 默认、zh 可选
  const { current } = useWorkspace()
  const api = useApi()
  const wsId = current?.id ?? ''
  const base = '/api/schedules'

  const [createOpen, setCreateOpen] = useState(false)

  
  
  const tzLabel = browserTzLabel()

  

  const plansQ = useQuery({
    queryKey: ['schedules', wsId],
    queryFn: () => api.get<{ items: SchedulePlan[] }>(base),
    enabled: !!wsId,
  })

  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['schedules', wsId] })
  const onError = (e: unknown, fallback: string) => toast.error(apiErrorMessage(e, fallback))

  

  const toggle = useMutation({
    mutationFn: (p: SchedulePlan) =>
      api.patch<SchedulePlan>(`${base}/${p.id}`, { enabled: !p.enabled }),
    onSuccess: async () => { toast.success(t('workspace.schedules.toastStatusUpdated')); await invalidate() },
    onError: (e) => onError(e, t('workspace.schedules.toastOpFailed')),
  })

  const create = useMutation({
    mutationFn: (values: CreateForm) => api.post<SchedulePlan>(base, values),
    onSuccess: async () => { toast.success(t('workspace.schedules.toastCreated')); await invalidate() },
    onError: (e) => onError(e, t('workspace.schedules.toastCreateFailed')),
  })

  
  
  const [editing, setEditing] = useState<SchedulePlan | null>(null)
  const updateM = useMutation({
    mutationFn: (v: { plan: SchedulePlan; body: Partial<Pick<SchedulePlan, 'cron_expr' | 'timezone' | 'misfire'>> }) =>
      api.patch<SchedulePlan>(`${base}/${v.plan.id}`, v.body),
    onSuccess: async (_d, v) => {
      toast.success(t('workspace.schedules.toastUpdated', { kind: v.plan.kind }))
      setEditing(null)
      await invalidate()
    },
    onError: (e) => onError(e, t('workspace.schedules.toastUpdateFailed')),
  })

  
  
  
  const confirm = useConfirm()
  const removeM = useMutation({
    mutationFn: (p: SchedulePlan) => api.delete<void>(`${base}/${p.id}`),
    onSuccess: async (_d, p) => { toast.success(t('workspace.schedules.toastDeleted', { kind: p.kind })); await invalidate() },
    onError: (e) => onError(e, t('workspace.schedules.toastDeleteFailed')),
  })
  const onRemove = async (p: SchedulePlan) => {
    const ok = await confirm({
      title: t('workspace.schedules.removeTitle'),
      description: t('workspace.schedules.removeDesc', {
        kind: p.kind,
        cron: describeCron(p.cron_expr),
        tz: p.timezone,
        next: formatDateTimeTz(p.next_fire_at),
      }),
      confirmText: t('workspace.schedules.remove'),
      danger: true,
    })
    if (ok) removeM.mutate(p)
  }

  

  const form = useZodForm<CreateForm>({
    schema: createSchema,
    defaultValues: { kind: '', cron_expr: '0 9 * * *', timezone: localTimezone(), misfire: 'skip' },
  })
  const cronValue = { cron: form.watch('cron_expr') ?? '', timezone: form.watch('timezone') ?? 'UTC' }
  const setCron = (v: { cron: string; timezone: string }) => {
    form.setValue('cron_expr', v.cron, { shouldValidate: true })
    form.setValue('timezone', v.timezone, { shouldValidate: true })
  }
  const submitCreate = form.handleSubmit((values) => {
    create.mutate(values, {
      onSuccess: () => {
        form.reset()
        setCreateOpen(false)
      },
    })
  })

  
  const editForm = useZodForm<CreateForm>({
    schema: createSchema,
    defaultValues: { kind: '', cron_expr: '', timezone: 'UTC', misfire: 'skip' },
    values: editing
      ? {
          kind: editing.kind,
          cron_expr: editing.cron_expr,
          timezone: editing.timezone,
          misfire: editing.misfire === 'once' ? 'once' : 'skip',
        }
      : undefined,
  })
  const editCronValue = { cron: editForm.watch('cron_expr') ?? '', timezone: editForm.watch('timezone') ?? 'UTC' }
  const setEditCron = (v: { cron: string; timezone: string }) => {
    editForm.setValue('cron_expr', v.cron, { shouldValidate: true })
    editForm.setValue('timezone', v.timezone, { shouldValidate: true })
  }
  const submitEdit = editForm.handleSubmit((values) => {
    if (!editing) return
    const body: Partial<Pick<SchedulePlan, 'cron_expr' | 'timezone' | 'misfire'>> = {}
    if (values.cron_expr !== editing.cron_expr) body.cron_expr = values.cron_expr
    if (values.timezone !== editing.timezone) body.timezone = values.timezone
    if (values.misfire !== editing.misfire) body.misfire = values.misfire
    if (Object.keys(body).length === 0) {
      setEditing(null) 
      return
    }
    updateM.mutate({ plan: editing, body })
  })

  

  const columns: Column<SchedulePlan>[] = [
    {


      key: 'kind', header: t('workspace.schedules.colTrigger'),
      render: (p) => (
        <div className="min-w-0">
          <code className="block max-w-[20rem] break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{p.kind}</code>
          <p className="mt-1 max-w-[20rem] break-words text-xs text-muted-foreground">{describeCron(p.cron_expr)}</p>
        </div>
      ),
    },
    {
      key: 'cron', header: t('workspace.schedules.colExprTz'),
      render: (p) => (
        <div className="min-w-0">
          <code className="block max-w-[20rem] break-all font-mono text-xs">{p.cron_expr}</code>
          <p className="max-w-[20rem] break-words text-xs text-muted-foreground">{p.timezone}</p>
        </div>
      ),
    },
    {
      key: 'misfire', header: t('workspace.schedules.fieldMisfire'),
      render: (p) => (
        <Badge variant="outline">
          {MISFIRE_LABEL[p.misfire] ? t(MISFIRE_LABEL[p.misfire]) : p.misfire}
        </Badge>
      ),
    },
    {
      key: 'next_fire_at', header: t('workspace.schedules.colNextRun'),
      render: (p) => (

        <Tooltip>
          <TooltipTrigger
            render={<span className="whitespace-nowrap text-muted-foreground" tabIndex={0} />}
          >
            {formatDateTimeTz(p.next_fire_at)}
          </TooltipTrigger>
          <TooltipContent>
            {t('workspace.schedules.tzTooltip', { tz: p.timezone, browserTz: tzLabel })}
          </TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: 'last_fired_at', header: t('workspace.schedules.colLastRun'),
      render: (p) => p.last_fired_at
        ? (
          <Tooltip>
            <TooltipTrigger
              render={<span className="whitespace-nowrap text-muted-foreground" tabIndex={0} />}
            >
              {formatDateTimeTz(p.last_fired_at)}
            </TooltipTrigger>
            <TooltipContent>
              {t('workspace.schedules.tzTooltip', { tz: p.timezone, browserTz: tzLabel })}
            </TooltipContent>
          </Tooltip>
        )
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'enabled', header: t('workspace.schedules.colEnabled'),
      render: (p) => (

        <Switch
          checked={p.enabled}
          disabled={toggle.isPending}
          onCheckedChange={() => toggle.mutate(p)}
          aria-label={p.enabled
            ? t('workspace.schedules.disableAria', { kind: p.kind })
            : t('workspace.schedules.enableAria', { kind: p.kind })}
        />
      ),
    },
    {

      key: 'actions', header: '', className: 'text-right',
      render: (p) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
            {t('workspace.schedules.edit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={removeM.isPending}
            onClick={() => void onRemove(p)}
          >
            {t('workspace.schedules.remove')}
          </Button>
        </div>
      ),
    },
  ]

  

  if (!wsId) {
    return (
      <div>
        <PageHeader title={t('workspace.schedules.title')} />
        <PageEmpty label={t('workspace.schedules.needWorkspace')} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={t('workspace.schedules.title')}
        actions={<Button onClick={() => setCreateOpen(true)}><Plus /> {t('workspace.schedules.createAction')}</Button>}
      />

      {plansQ.isError ? (
        <PageError message={apiErrorMessage(plansQ.error, t('workspace.schedules.loadError'))} onRetry={() => plansQ.refetch()} />
      ) : plansQ.isPending ? (
        <PageLoading label={t('workspace.schedules.loading')} />
      ) : (
        <DataTable
          columns={columns}
          rows={plansQ.data?.items ?? []}
          rowKey={(p) => p.id}
          empty={<PageEmpty label={t('workspace.schedules.emptyLabel')} hint={t('workspace.schedules.emptyHint')} />}
        />
      )}

      {/* 创建计划 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspace.schedules.createTitle')}</DialogTitle>
            <DialogDescription>
              {t('workspace.schedules.createDesc')}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitCreate}>
            <FormField label={t('workspace.schedules.fieldKind')} error={form.formState.errors.kind?.message} htmlFor="sched-kind">
              <Input id="sched-kind" placeholder="task.cleanup" {...form.register('kind')} />
            </FormField>
            <FormField label={t('workspace.schedules.fieldRule')} error={form.formState.errors.cron_expr?.message ?? form.formState.errors.timezone?.message}>
              <CronInput idPrefix="sched" value={cronValue} onChange={setCron} />
            </FormField>
            <FormField label={t('workspace.schedules.fieldMisfire')} error={form.formState.errors.misfire?.message} htmlFor="sched-misfire">
              <Select
                value={form.watch('misfire')}
                onValueChange={(v) => form.setValue('misfire', v === 'once' ? 'once' : 'skip', { shouldValidate: true })}
              >
                <SelectTrigger id="sched-misfire" className="w-full">
                  <SelectValue>{form.watch('misfire') === 'once' ? t('workspace.schedules.misfireOnceFull') : t('workspace.schedules.misfireSkipDefault')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">{t('workspace.schedules.misfireSkipDefault')}</SelectItem>
                  <SelectItem value="once">{t('workspace.schedules.misfireOnceFull')}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t('workspace.schedules.cancel')}</Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? t('workspace.schedules.creating') : t('workspace.schedules.createAction')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* P3-42：编辑计划（换表达式/时区/错过策略；kind 与启停不改——启停在行内 Switch） */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspace.schedules.editTitle')}</DialogTitle>
            <DialogDescription>
              {t('workspace.schedules.editDesc', { kind: editing?.kind ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitEdit}>
            <FormField label={t('workspace.schedules.fieldKindReadonly')} htmlFor="sched-edit-kind">
              <Input id="sched-edit-kind" value={editing?.kind ?? ''} readOnly disabled />
            </FormField>
            <FormField label={t('workspace.schedules.fieldRule')} error={editForm.formState.errors.cron_expr?.message ?? editForm.formState.errors.timezone?.message}>
              <CronInput idPrefix="sched-edit" value={editCronValue} onChange={setEditCron} />
            </FormField>
            <FormField label={t('workspace.schedules.fieldMisfire')} error={editForm.formState.errors.misfire?.message} htmlFor="sched-edit-misfire">
              <Select
                value={editForm.watch('misfire')}
                onValueChange={(v) => editForm.setValue('misfire', v === 'once' ? 'once' : 'skip', { shouldValidate: true })}
              >
                <SelectTrigger id="sched-edit-misfire" className="w-full">
                  <SelectValue>{editForm.watch('misfire') === 'once' ? t('workspace.schedules.misfireOnceFull') : t('workspace.schedules.misfireSkipDefault')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">{t('workspace.schedules.misfireSkipDefault')}</SelectItem>
                  <SelectItem value="once">{t('workspace.schedules.misfireOnceFull')}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t('workspace.schedules.cancel')}</Button>
              <Button type="submit" disabled={updateM.isPending}>
                {updateM.isPending ? t('workspace.schedules.saving') : t('workspace.schedules.saveChanges')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

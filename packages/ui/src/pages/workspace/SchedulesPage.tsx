
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
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

export const MISFIRE_LABEL: Record<string, string> = {
  skip: '错过跳过',
  once: '错过补发',
}


function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export const createSchema = z.object({
  kind: z.string().check(
    z.trim(),
    z.minLength(1, '请填写触发标识（kind），如 task.cleanup'),
  ),
  cron_expr: z.string().check(
    z.trim(),
    z.regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, '表达式须为五字段：分 时 日 月 周'),
  ),
  timezone: z.string().check(z.minLength(1, '请选择时区')),
  misfire: z.enum(['skip', 'once']),
})
type CreateForm = z.infer<typeof createSchema>

export interface SchedulesPageProps {}

export function SchedulesPage(_props: SchedulesPageProps = {}) {
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
    onSuccess: async () => { toast.success('状态已更新'); await invalidate() },
    onError: (e) => onError(e, '操作失败'),
  })

  const create = useMutation({
    mutationFn: (values: CreateForm) => api.post<SchedulePlan>(base, values),
    onSuccess: async () => { toast.success('计划已创建'); await invalidate() },
    onError: (e) => onError(e, '创建失败'),
  })

  
  
  const [editing, setEditing] = useState<SchedulePlan | null>(null)
  const updateM = useMutation({
    mutationFn: (v: { plan: SchedulePlan; body: Partial<Pick<SchedulePlan, 'cron_expr' | 'timezone' | 'misfire'>> }) =>
      api.patch<SchedulePlan>(`${base}/${v.plan.id}`, v.body),
    onSuccess: async (_d, v) => {
      toast.success(`计划 ${v.plan.kind} 已更新`)
      setEditing(null)
      await invalidate()
    },
    onError: (e) => onError(e, '更新失败'),
  })

  
  
  
  const confirm = useConfirm()
  const removeM = useMutation({
    mutationFn: (p: SchedulePlan) => api.delete<void>(`${base}/${p.id}`),
    onSuccess: async (_d, p) => { toast.success(`计划 ${p.kind} 已删除`); await invalidate() },
    onError: (e) => onError(e, '删除失败'),
  })
  const onRemove = async (p: SchedulePlan) => {
    const ok = await confirm({
      title: '删除调度计划',
      description:
        `确定删除计划 ${p.kind}（${describeCron(p.cron_expr)}，计划时区 ${p.timezone}）吗？` +
        `下次触发 ${formatDateTimeTz(p.next_fire_at)}。删除后该计划不再触发，操作不可恢复。`,
      confirmText: '删除',
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
      
      
      key: 'kind', header: '触发',
      render: (p) => (
        <div className="min-w-0">
          <code className="block max-w-[20rem] break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{p.kind}</code>
          <p className="mt-1 max-w-[20rem] break-words text-xs text-muted-foreground">{describeCron(p.cron_expr)}</p>
        </div>
      ),
    },
    {
      key: 'cron', header: '表达式 / 时区',
      render: (p) => (
        <div className="min-w-0">
          <code className="block max-w-[20rem] break-all font-mono text-xs">{p.cron_expr}</code>
          <p className="max-w-[20rem] break-words text-xs text-muted-foreground">{p.timezone}</p>
        </div>
      ),
    },
    {
      key: 'misfire', header: '错过策略',
      render: (p) => (
        <Badge variant="outline">
          {MISFIRE_LABEL[p.misfire] ?? p.misfire}
        </Badge>
      ),
    },
    {
      key: 'next_fire_at', header: '下次触发',
      render: (p) => (
        
        <Tooltip>
          <TooltipTrigger
            render={<span className="whitespace-nowrap text-muted-foreground" tabIndex={0} />}
          >
            {formatDateTimeTz(p.next_fire_at)}
          </TooltipTrigger>
          <TooltipContent>
            计划时区 {p.timezone}；此处按浏览器本地时区（{tzLabel}）显示
          </TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: 'last_fired_at', header: '最近触发',
      render: (p) => p.last_fired_at
        ? (
          <Tooltip>
            <TooltipTrigger
              render={<span className="whitespace-nowrap text-muted-foreground" tabIndex={0} />}
            >
              {formatDateTimeTz(p.last_fired_at)}
            </TooltipTrigger>
            <TooltipContent>
              计划时区 {p.timezone}；此处按浏览器本地时区（{tzLabel}）显示
            </TooltipContent>
          </Tooltip>
          )
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'enabled', header: '启用',
      render: (p) => (
        
        <Switch
          checked={p.enabled}
          disabled={toggle.isPending}
          onCheckedChange={() => toggle.mutate(p)}
          aria-label={`${p.enabled ? '停用' : '启用'}计划 ${p.kind}`}
        />
      ),
    },
    {
      
      key: 'actions', header: '', className: 'text-right',
      render: (p) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={removeM.isPending}
            onClick={() => void onRemove(p)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ]

  

  if (!wsId) {
    return (
      <div>
        <PageHeader title="调度" />
        <PageEmpty label="请先创建并选择一个工作区" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="调度"
        actions={<Button onClick={() => setCreateOpen(true)}><Plus /> 创建计划</Button>}
      />

      {plansQ.isError ? (
        <PageError message={apiErrorMessage(plansQ.error, '计划列表加载失败')} onRetry={() => plansQ.refetch()} />
      ) : plansQ.isPending ? (
        <PageLoading label="加载计划…" />
      ) : (
        <DataTable
          columns={columns}
          rows={plansQ.data?.items ?? []}
          rowKey={(p) => p.id}
          empty={<PageEmpty label="暂无调度计划" hint="创建计划后，任务将按设定的 cron 规则定时触发" />}
        />
      )}

      {/* 创建计划 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建调度计划</DialogTitle>
            <DialogDescription>
              五字段 cron 表达式 + IANA 时区；错过策略“跳过”等下一个周期，
              “补发”会先补最近一次。预览与实际触发一致。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitCreate}>
            <FormField label="触发标识（kind）" error={form.formState.errors.kind?.message} htmlFor="sched-kind">
              <Input id="sched-kind" placeholder="task.cleanup" {...form.register('kind')} />
            </FormField>
            <FormField label="调度规则" error={form.formState.errors.cron_expr?.message ?? form.formState.errors.timezone?.message}>
              <CronInput idPrefix="sched" value={cronValue} onChange={setCron} />
            </FormField>
            <FormField label="错过策略" error={form.formState.errors.misfire?.message} htmlFor="sched-misfire">
              <Select
                value={form.watch('misfire')}
                onValueChange={(v) => form.setValue('misfire', v === 'once' ? 'once' : 'skip', { shouldValidate: true })}
              >
                <SelectTrigger id="sched-misfire" className="w-full">
                  <SelectValue>{form.watch('misfire') === 'once' ? '错过补发一次' : '错过跳过（默认）'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">错过跳过（默认）</SelectItem>
                  <SelectItem value="once">错过补发一次</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? '创建中…' : '创建计划'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* P3-42：编辑计划（换表达式/时区/错过策略；kind 与启停不改——启停在行内 Switch） */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑调度计划</DialogTitle>
            <DialogDescription>
              修改 {editing?.kind} 的调度规则；下次触发时间按新规则重新计算。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitEdit}>
            <FormField label="触发标识（kind，不可修改）" htmlFor="sched-edit-kind">
              <Input id="sched-edit-kind" value={editing?.kind ?? ''} readOnly disabled />
            </FormField>
            <FormField label="调度规则" error={editForm.formState.errors.cron_expr?.message ?? editForm.formState.errors.timezone?.message}>
              <CronInput idPrefix="sched-edit" value={editCronValue} onChange={setEditCron} />
            </FormField>
            <FormField label="错过策略" error={editForm.formState.errors.misfire?.message} htmlFor="sched-edit-misfire">
              <Select
                value={editForm.watch('misfire')}
                onValueChange={(v) => editForm.setValue('misfire', v === 'once' ? 'once' : 'skip', { shouldValidate: true })}
              >
                <SelectTrigger id="sched-edit-misfire" className="w-full">
                  <SelectValue>{editForm.watch('misfire') === 'once' ? '错过补发一次' : '错过跳过（默认）'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">错过跳过（默认）</SelectItem>
                  <SelectItem value="once">错过补发一次</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>取消</Button>
              <Button type="submit" disabled={updateM.isPending}>
                {updateM.isPending ? '保存中…' : '保存修改'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}


import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Plus } from 'lucide-react'
import * as z from 'zod/mini'
import type { components } from '@ploykit/client'
import {
  PageHeader, PageLoading, PageError, PageEmpty,
} from '../../components/Page'
import { DataTable, type Column } from '../../components/DataTable'
import { FormField } from '../../components/FormField'
import { SecretModal } from '../../components/SecretModal'
import { useConfirm } from '../../components/ConfirmDialog'
import { toast } from '../../components/toast'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'
import { Spinner } from '../../components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { StatusBadge } from '../../components/StatusBadge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { Switch } from '../../components/ui/switch'
import { Checkbox } from '../../components/ui/checkbox'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import { useApi } from '@ploykit/hooks'
import { useWorkspace } from '@ploykit/hooks'
import { useZodForm } from '@ploykit/hooks'
import { queryKeys } from '@ploykit/hooks'
import { formatDateTime } from '../../lib/utils'
import { apiErrorMessage } from '../../lib/api-error'
import { roleSatisfies } from '@ploykit/hooks'
import { useT, t as moduleT } from '../../i18n'



type Subscription = components['schemas']['WebhookSubscription']
type Delivery = components['schemas']['WebhookDelivery']
type EventMeta = components['schemas']['WebhookEventItem']
type RotateSecretResponse = components['schemas']['RotateWebhookSecretResponse']

export const createSchema = z.object({

  url: z.string().check(
    // g6 i18n：校验文案经模块级 t() 在校验时解析（error 回调惰性求值，随 setUiLang 变化）
    z.url({ error: () => moduleT('workspace.webhooks.urlInvalid') }),
    z.refine((v) => v.startsWith('https://'), { error: () => moduleT('workspace.webhooks.urlHttps') }),
  ),
  description: z.string(),
  events: z.array(z.string()).check(z.minLength(1, { error: () => moduleT('workspace.webhooks.eventsMin') })),
})
type CreateForm = z.infer<typeof createSchema>

export interface WebhooksPageProps {}

export function WebhooksPage(_props: WebhooksPageProps = {}) {
  const t = useT()
  const { current } = useWorkspace()
  const api = useApi()
  const confirm = useConfirm()
  const wsId = current?.id ?? ''
  const base = `/api/workspaces/${wsId}/webhooks`
  
  const canManage = roleSatisfies(current?.role, 'admin')

  const [createOpen, setCreateOpen] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  
  const [secretTitle, setSecretTitle] = useState<string | undefined>(undefined)

  

  const subsQ = useQuery({
    queryKey: [...queryKeys.webhooks(wsId), 'subscriptions'] as const,
    queryFn: () => api.get<{ items: Subscription[] }>(`${base}/subscriptions`),
    enabled: !!wsId,
  })
  const deliveriesQ = useQuery({
    queryKey: [...queryKeys.webhooks(wsId), 'deliveries'] as const,
    queryFn: () => api.get<{ items: Delivery[] }>(`${base}/deliveries?limit=50`),
    enabled: !!wsId,
    
    
    
    
    refetchInterval: 15_000,
  })
  const eventsQ = useQuery({
    queryKey: [...queryKeys.webhooks(wsId), 'events'] as const,
    queryFn: () => api.get<{ items: EventMeta[] }>(`${base}/events`),
    enabled: !!wsId,
  })

  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.webhooks(wsId) })
  const onError = (e: unknown, fallback: string) => toast.error(apiErrorMessage(e, fallback))

  

  const toggle = useMutation({
    mutationFn: (s: Subscription) =>
      api.patch<Subscription>(`${base}/subscriptions/${s.id}`, { is_active: !s.is_active }),
    onSuccess: async () => { toast.success(t('workspace.webhooks.toggleOk')); await invalidate() },
    onError: (e) => onError(e, t('workspace.webhooks.opFailed')),
  })

  const ping = useMutation({
    mutationFn: (id: string) => api.post(`${base}/subscriptions/${id}/ping`),
    onSuccess: async () => { toast.success(t('workspace.webhooks.pingOk')); await invalidate() },
    onError: (e) => onError(e, t('workspace.webhooks.pingFailed')),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${base}/subscriptions/${id}`),
    onSuccess: async () => { toast.success(t('workspace.webhooks.removed')); await invalidate() },
    onError: (e) => onError(e, t('workspace.webhooks.deleteFailed')),
  })

  const redeliver = useMutation({
    mutationFn: (id: string) => api.post<Delivery>(`${base}/deliveries/${id}/redeliver`),
    onSuccess: async () => { toast.success(t('workspace.webhooks.redeliverOk')); await invalidate() },
    onError: (e) => onError(e, t('workspace.webhooks.redeliverFailed')),
  })


  const create = useMutation({
    mutationFn: (values: CreateForm) =>
      api.post<{ subscription: Subscription; secret: string }>(`${base}/subscriptions`, values),
    onSuccess: async (data) => {
      toast.success(t('workspace.webhooks.created'))
      setSecretTitle(undefined)
      setSecret(data.secret)
      await invalidate()
    },
    onError: (e) => onError(e, t('workspace.webhooks.createFailed')),
  });





  const rotate = useMutation({
    mutationFn: (id: string) =>
      api.post<RotateSecretResponse>(`${base}/subscriptions/${id}/rotate-secret`),
    onSuccess: async (data) => {
      toast.success(t('workspace.webhooks.rotated'))
      setSecretTitle(t('workspace.webhooks.rotatedTitle'))
      setSecret(data.secret)
      await invalidate()
    },
    onError: (e) => onError(e, t('workspace.webhooks.rotateFailed')),
  })

  
  const latestBySub = useMemo(() => {
    const map = new Map<string, Delivery>()
    for (const d of deliveriesQ.data?.items ?? []) {
      if (!map.has(d.subscription_id)) map.set(d.subscription_id, d)
    }
    return map
  }, [deliveriesQ.data])

  
  
  
  
  const subById = useMemo(() => {
    const map = new Map<string, Subscription>()
    for (const s of subsQ.data?.items ?? []) map.set(s.id, s)
    return map
  }, [subsQ.data])

  

  const form = useZodForm<CreateForm>({
    schema: createSchema,
    defaultValues: { url: '', description: '', events: [] },
  })
  const selectedEvents = form.watch('events') ?? []
  const toggleEvent = (type: string, checked: boolean) => {
    form.setValue(
      'events',
      checked ? [...selectedEvents, type] : selectedEvents.filter((t) => t !== type),
      { shouldValidate: true },
    )
  }
  const submitCreate = form.handleSubmit((values) => {
    create.mutate(values, {
      onSuccess: () => {
        form.reset()
        setCreateOpen(false)
      },
    })
  })

  
  const closeSecret = () => {
    setSecret(null)
    setSecretTitle(undefined)
  }

  

  const onRedeliverLatest = async (s: Subscription) => {
    const latest = latestBySub.get(s.id)
    if (!latest) {
      toast.info(t('workspace.webhooks.noDeliveriesInfo'))
      return
    }
    await redeliver.mutateAsync(latest.id).catch(() => {})
  }

  const onRemove = async (s: Subscription) => {
    if (!(await confirm({
      title: t('workspace.webhooks.deleteTitle'),
      description: t('workspace.webhooks.deleteDesc', { url: s.url }),
      confirmText: t('workspace.webhooks.deleteConfirm'), danger: true,
    }))) return
    remove.mutate(s.id)
  }


  const onRotate = async (s: Subscription) => {
    if (!(await confirm({
      title: t('workspace.webhooks.rotateTitle'),
      description: t('workspace.webhooks.rotateDesc', { url: s.url }),
      confirmText: t('workspace.webhooks.rotateConfirm'),
    }))) return
    rotate.mutate(s.id)
  }

  

  const subColumns: Column<Subscription>[] = [
    {
      key: 'url', header: t('workspace.webhooks.colEndpoint'),
      render: (s) => (
        <div className="min-w-0 max-w-xs">
          <p className="truncate font-medium">{s.url}</p>
          {s.description && <p className="truncate text-xs text-muted-foreground">{s.description}</p>}
        </div>
      ),
    },
    {
      key: 'events', header: t('workspace.webhooks.colEvents'),
      render: (s) => (
        <div className="flex max-w-xs flex-wrap gap-1">
          {s.event_types.map((t) => (
            <Badge key={t} variant="secondary" className="font-mono">{t}</Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'is_active', header: t('workspace.webhooks.colActive'),

      render: (s) =>
        canManage ? (
          <Switch
            checked={s.is_active}
            disabled={toggle.isPending}
            onCheckedChange={() => toggle.mutate(s)}
            aria-label={s.is_active
              ? t('workspace.webhooks.pauseSub', { url: s.url })
              : t('workspace.webhooks.resumeSub', { url: s.url })}
          />
        ) : (
          <span className="text-xs text-muted-foreground">
            {s.is_active ? t('workspace.webhooks.activeOn') : t('workspace.webhooks.activeOff')}
          </span>
        ),
    },
    {
      key: 'latest', header: t('workspace.webhooks.colLatest'),
      render: (s) => {
        const d = latestBySub.get(s.id)
        return d ? (
          <div className="min-w-0">
            <StatusBadge status={d.status} />
            <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(d.created_at)}</p>
          </div>
        ) : <span className="text-muted-foreground">—</span>
      },
    },
    {
      key: 'attempts', header: t('workspace.webhooks.colAttempts'),
      render: (s) => {
        const d = latestBySub.get(s.id)
        return <span className="tabular-nums">{d ? d.attempts : 0}</span>
      },
    },
    {
      key: 'actions', header: '', className: 'w-10',


      render: (s) =>
        canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" aria-label={t('workspace.webhooks.actionsAria', { url: s.url })} />}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => ping.mutate(s.id)}>{t('workspace.webhooks.sendPing')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRedeliverLatest(s)}>{t('workspace.webhooks.redeliverLatest')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRotate(s)}>{t('workspace.webhooks.rotateSecret')}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => onRemove(s)}>{t('workspace.webhooks.deleteConfirm')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ]

  const deliveryColumns: Column<Delivery>[] = [
    {
      key: 'event', header: t('workspace.webhooks.colEvent'),
      render: (d) => (
        <div className="min-w-0">
          <p className="font-medium">{d.event_type}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{d.event_id}</p>
        </div>
      ),
    },
    {

      key: 'subscription', header: t('workspace.webhooks.colSubscription'),
      render: (d) => {
        const sub = subById.get(d.subscription_id)
        if (sub) {
          return (
            <Tooltip>
              <TooltipTrigger className="block max-w-xs truncate text-left font-mono text-xs">
                {sub.url}
              </TooltipTrigger>
              <TooltipContent>{sub.url}</TooltipContent>
            </Tooltip>
          )
        }
        return subsQ.isSuccess ? (
          <Badge variant="outline" className="text-muted-foreground">{t('workspace.webhooks.deletedSub')}</Badge>
        ) : <span className="text-muted-foreground">—</span>
      },
    },
    { key: 'status', header: t('workspace.webhooks.colStatus'), render: (d) => <StatusBadge status={d.status} /> },
    {
      key: 'attempts', header: t('workspace.webhooks.colAttempts'),
      render: (d) => (
        <span className="tabular-nums">
          {d.attempts}
          {d.last_status_code ? <span className="ml-1 text-xs text-muted-foreground">HTTP {d.last_status_code}</span> : null}
        </span>
      ),
    },
    {
      key: 'last_error', header: t('workspace.webhooks.colLastError'),
      render: (d) =>
        d.last_error ? (
          <Tooltip>
            <TooltipTrigger className="block max-w-xs truncate text-left text-xs text-destructive">
              {d.last_error}
            </TooltipTrigger>
            <TooltipContent className="break-all">{d.last_error}</TooltipContent>
          </Tooltip>
        ) : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'created_at', header: t('workspace.webhooks.colTime'),
      render: (d) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(d.created_at)}</span>,
    },
    {
      key: 'actions', header: t('workspace.webhooks.colActions'), className: 'text-right',

      render: (d) =>
        canManage ? (
          <Button size="sm" variant="outline" disabled={redeliver.isPending} onClick={() => redeliver.mutate(d.id)}>
            {t('workspace.webhooks.redeliver')}
          </Button>
        ) : null,
    },
  ]

  

  if (!wsId) {
    return (
      <div>
        <PageHeader title={t('workspace.webhooks.title')} />
        <PageEmpty label={t('workspace.webhooks.emptyNoWs')} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={t('workspace.webhooks.title')}
        actions={canManage ? <Button onClick={() => setCreateOpen(true)}><Plus /> {t('workspace.webhooks.createSubscription')}</Button> : undefined}
      />

      <Tabs defaultValue="subscriptions">
        <TabsList>
          <TabsTrigger value="subscriptions">{t('workspace.webhooks.tabSubscriptions')}</TabsTrigger>
          <TabsTrigger value="deliveries">{t('workspace.webhooks.tabDeliveries')}</TabsTrigger>
        </TabsList>

        <TabsContent value="subscriptions" className="mt-4 space-y-4">
          {subsQ.isError ? (
            <PageError message={apiErrorMessage(subsQ.error, t('workspace.webhooks.subsLoadFailed'))} onRetry={() => subsQ.refetch()} />
          ) : subsQ.isPending ? (
            <PageLoading label={t('workspace.webhooks.loadingSubs')} />
          ) : (
            <DataTable
              columns={subColumns}
              rows={subsQ.data?.items ?? []}
              rowKey={(s) => s.id}
              empty={<PageEmpty label={t('workspace.webhooks.noSubs')} hint={t('workspace.webhooks.noSubsHint')} />}
            />
          )}
        </TabsContent>

        <TabsContent value="deliveries" className="mt-4">
          {deliveriesQ.isError ? (
            <PageError message={apiErrorMessage(deliveriesQ.error, t('workspace.webhooks.deliveriesLoadFailed'))} onRetry={() => deliveriesQ.refetch()} />
          ) : deliveriesQ.isPending ? (
            <PageLoading label={t('workspace.webhooks.loadingDeliveries')} />
          ) : (
            <DataTable
              columns={deliveryColumns}
              rows={deliveriesQ.data?.items ?? []}
              rowKey={(d) => d.id}
              empty={<PageEmpty label={t('workspace.webhooks.noDeliveries')} hint={t('workspace.webhooks.noDeliveriesHint')} />}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* 创建订阅 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspace.webhooks.createSubscription')}</DialogTitle>
            <DialogDescription>
              {t('workspace.webhooks.dialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitCreate}>
            <FormField label={t('workspace.webhooks.urlLabel')} error={form.formState.errors.url?.message} htmlFor="whk-url">
              <Input id="whk-url" placeholder="https://example.com/webhook" {...form.register('url')} />
            </FormField>
            <FormField label={t('workspace.webhooks.descLabel')} error={form.formState.errors.description?.message} htmlFor="whk-desc">
              <Input id="whk-desc" placeholder={t('workspace.webhooks.descPlaceholder')} {...form.register('description')} />
            </FormField>
            <FormField label={t('workspace.webhooks.eventsLabel')} error={form.formState.errors.events?.message}>
              <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-3">
                {(eventsQ.data?.items ?? []).map((ev) => {







                  const cbId = `whk-evt-${ev.type.replace(/[^a-zA-Z0-9-]/g, '-')}`
                  const checked = selectedEvents.includes(ev.type)
                  return (
                    <label
                      key={ev.type}
                      className="flex items-start gap-2 text-sm"
                      htmlFor={cbId}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('[data-slot="checkbox"]')) return
                        e.preventDefault()
                        toggleEvent(ev.type, !checked)
                      }}
                    >
                      <Checkbox
                        id={cbId}
                        checked={checked}
                        onCheckedChange={(c) => toggleEvent(ev.type, c === true)}
                      />
                      <span className="min-w-0">
                        <Badge variant="secondary" className="font-mono">{ev.type}</Badge>
                        {ev.description && <span className="ml-2 text-xs text-muted-foreground">{ev.description}</span>}
                      </span>
                    </label>
                  )
                })}
                {eventsQ.isPending && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Spinner className="size-3" />
                    {t('workspace.webhooks.loadingEvents')}
                  </p>
                )}
              </div>
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t('workspace.webhooks.cancel')}</Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending
                  ? (<><Spinner aria-hidden="true" />{t('workspace.webhooks.creating')}</>)
                  : t('workspace.webhooks.createSubscription')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 一次性签名密钥（创建/轮换共用：明文只显示一次） */}
      <SecretModal
        open={secret !== null}
        onOpenChange={(o) => !o && closeSecret()}
        secretName={t('workspace.webhooks.secretName')}
        secretValue={secret ?? ''}
        title={secretTitle}
      />
    </div>
  )
}

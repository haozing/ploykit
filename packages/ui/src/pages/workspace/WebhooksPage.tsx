
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Plus } from 'lucide-react'
import { z } from 'zod'
import type { components } from '@ploykit/client'
import {
  PageHeader, PageLoading, PageError, PageEmpty,
} from '../../components/Page'
import { DataTable, type Column } from '../../components/DataTable'
import { FormField } from '../../components/FormField'
import { SecretModal } from '../../components/SecretModal'
import { useConfirm } from '../../components/ConfirmDialog'
import { toast } from '../../components/toast'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { StatusBadge } from '../../components/ui/Badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { Switch } from '../../components/ui/switch'
import { Checkbox } from '../../components/ui/checkbox'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../../components/ui/menu'
import { useApi } from '../../hooks/useApi'
import { useWorkspace } from '../../hooks/useWorkspace'
import { useZodForm } from '../../hooks/useZodForm'
import { queryKeys } from '../../provider/PloykitProvider'
import { formatDateTime } from '../../lib/utils'
import { apiErrorMessage } from '../../lib/api-error'
import { roleSatisfies } from '../../lib/perm'



type Subscription = components['schemas']['WebhookSubscription']
type Delivery = components['schemas']['WebhookDelivery']
type EventMeta = components['schemas']['WebhookEventItem']
type RotateSecretResponse = components['schemas']['RotateWebhookSecretResponse']

const createSchema = z.object({
  
  url: z
    .string()
    .url('请输入合法的回调 URL（如 https://example.com/webhook）')
    .refine((v) => v.startsWith('https://'), '回调地址必须使用 https（明文 http 会被服务端拒绝）'),
  description: z.string(),
  events: z.array(z.string()).min(1, '至少订阅一个事件类型'),
})
type CreateForm = z.infer<typeof createSchema>

export interface WebhooksPageProps {}

export function WebhooksPage(_props: WebhooksPageProps = {}) {
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
    onSuccess: async () => { toast.success('状态已更新'); await invalidate() },
    onError: (e) => onError(e, '操作失败'),
  })

  const ping = useMutation({
    mutationFn: (id: string) => api.post(`${base}/subscriptions/${id}/ping`),
    onSuccess: async () => { toast.success('Ping 已入队，结果见投递记录'); await invalidate() },
    onError: (e) => onError(e, 'Ping 失败'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${base}/subscriptions/${id}`),
    onSuccess: async () => { toast.success('订阅已删除'); await invalidate() },
    onError: (e) => onError(e, '删除失败'),
  })

  const redeliver = useMutation({
    mutationFn: (id: string) => api.post<Delivery>(`${base}/deliveries/${id}/redeliver`),
    onSuccess: async () => { toast.success('已重新入队投递'); await invalidate() },
    onError: (e) => onError(e, '重新投递失败'),
  })

  
  const create = useMutation({
    mutationFn: (values: CreateForm) =>
      api.post<{ subscription: Subscription; secret: string }>(`${base}/subscriptions`, values),
    onSuccess: async (data) => {
      toast.success('订阅已创建')
      setSecretTitle(undefined)
      setSecret(data.secret)
      await invalidate()
    },
    onError: (e) => onError(e, '创建失败'),
  })

  
  
  
  
  const rotate = useMutation({
    mutationFn: (id: string) =>
      api.post<RotateSecretResponse>(`${base}/subscriptions/${id}/rotate-secret`),
    onSuccess: async (data) => {
      toast.success('密钥已轮换')
      setSecretTitle('Webhook 签名密钥轮换成功')
      setSecret(data.secret)
      await invalidate()
    },
    onError: (e) => onError(e, '轮换密钥失败'),
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
      toast.info('该订阅暂无投递记录，可先发送 Ping')
      return
    }
    await redeliver.mutateAsync(latest.id).catch(() => {})
  }

  const onRemove = async (s: Subscription) => {
    if (!(await confirm({
      title: '删除订阅',
      description: `确定删除 ${s.url} 吗？该操作不可恢复。`,
      confirmText: '删除', danger: true,
    }))) return
    remove.mutate(s.id)
  }

  
  const onRotate = async (s: Subscription) => {
    if (!(await confirm({
      title: '轮换签名密钥',
      description: `确定轮换 ${s.url} 的签名密钥吗？新密钥仅显示一次；旧密钥在 24h 宽限期内继续有效（期间投递同时携带新/旧双签名），之后仅新密钥可用。`,
      confirmText: '轮换',
    }))) return
    rotate.mutate(s.id)
  }

  

  const subColumns: Column<Subscription>[] = [
    {
      key: 'url', header: '回调地址',
      render: (s) => (
        <div className="min-w-0 max-w-xs">
          <p className="truncate font-medium">{s.url}</p>
          {s.description && <p className="truncate text-xs text-muted-foreground">{s.description}</p>}
        </div>
      ),
    },
    {
      key: 'events', header: '事件类型',
      render: (s) => (
        <div className="flex max-w-xs flex-wrap gap-1">
          {s.event_types.map((t) => (
            <code key={t} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{t}</code>
          ))}
        </div>
      ),
    },
    {
      key: 'is_active', header: '启用',
      
      render: (s) =>
        canManage ? (
          <Switch
            checked={s.is_active}
            disabled={toggle.isPending}
            onCheckedChange={() => toggle.mutate(s)}
            aria-label={`${s.is_active ? '暂停' : '恢复'}订阅 ${s.url}`}
          />
        ) : (
          <span className="text-xs text-muted-foreground">{s.is_active ? '已启用' : '已暂停'}</span>
        ),
    },
    {
      key: 'latest', header: '最近投递',
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
      key: 'attempts', header: '尝试',
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
              className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent"
              aria-label={`订阅 ${s.url} 的操作`}
            >
              <MoreHorizontal className="size-4" />
              <span className="sr-only">打开菜单</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => ping.mutate(s.id)}>发送 Ping</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRedeliverLatest(s)}>重投最近一条</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRotate(s)}>轮换密钥</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => onRemove(s)}>删除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ]

  const deliveryColumns: Column<Delivery>[] = [
    {
      key: 'event', header: '事件',
      render: (d) => (
        <div className="min-w-0">
          <p className="font-medium">{d.event_type}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{d.event_id}</p>
        </div>
      ),
    },
    {
      
      key: 'subscription', header: '归属订阅',
      render: (d) => {
        const sub = subById.get(d.subscription_id)
        if (sub) {
          return (
            <span className="block max-w-xs truncate font-mono text-xs" title={sub.url}>
              {sub.url}
            </span>
          )
        }
        return subsQ.isSuccess ? (
          <span className="inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
            已删除订阅
          </span>
        ) : <span className="text-muted-foreground">—</span>
      },
    },
    { key: 'status', header: '状态', render: (d) => <StatusBadge status={d.status} /> },
    {
      key: 'attempts', header: '尝试',
      render: (d) => (
        <span className="tabular-nums">
          {d.attempts}
          {d.last_status_code ? <span className="ml-1 text-xs text-muted-foreground">HTTP {d.last_status_code}</span> : null}
        </span>
      ),
    },
    {
      key: 'last_error', header: '最后错误',
      render: (d) =>
        d.last_error ? (
          <span className="block max-w-xs truncate text-xs text-destructive" title={d.last_error}>
            {d.last_error}
          </span>
        ) : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'created_at', header: '时间',
      render: (d) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(d.created_at)}</span>,
    },
    {
      key: 'actions', header: '操作', className: 'text-right',
      
      render: (d) =>
        canManage ? (
          <Button size="sm" variant="outline" disabled={redeliver.isPending} onClick={() => redeliver.mutate(d.id)}>
            重新投递
          </Button>
        ) : null,
    },
  ]

  

  if (!wsId) {
    return (
      <div>
        <PageHeader title="Webhooks" description="出站事件订阅与投递管理" />
        <PageEmpty label="请先创建并选择一个工作区" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Webhooks"
        description={`出站事件订阅与投递管理（工作区：${current?.name ?? wsId}）`}
        
        actions={canManage ? <Button onClick={() => setCreateOpen(true)}><Plus /> 创建订阅</Button> : undefined}
      />

      <Tabs defaultValue="subscriptions">
        <TabsList>
          <TabsTrigger value="subscriptions">订阅</TabsTrigger>
          <TabsTrigger value="deliveries">投递记录</TabsTrigger>
        </TabsList>

        <TabsContent value="subscriptions" className="mt-4 space-y-4">
          {subsQ.isError ? (
            <PageError message={apiErrorMessage(subsQ.error, '订阅列表加载失败')} onRetry={() => subsQ.refetch()} />
          ) : subsQ.isPending ? (
            <PageLoading label="加载订阅…" />
          ) : (
            <DataTable
              columns={subColumns}
              rows={subsQ.data?.items ?? []}
              rowKey={(s) => s.id}
              empty={<PageEmpty label="暂无订阅" hint="点击右上角“创建订阅”接收第一个事件" />}
            />
          )}
        </TabsContent>

        <TabsContent value="deliveries" className="mt-4">
          {deliveriesQ.isError ? (
            <PageError message={apiErrorMessage(deliveriesQ.error, '投递记录加载失败')} onRetry={() => deliveriesQ.refetch()} />
          ) : deliveriesQ.isPending ? (
            <PageLoading label="加载投递记录…" />
          ) : (
            <DataTable
              columns={deliveryColumns}
              rows={deliveriesQ.data?.items ?? []}
              rowKey={(d) => d.id}
              empty={<PageEmpty label="暂无投递" hint="触发事件或发送 Ping 后，投递会出现在这里" />}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* 创建订阅 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建订阅</DialogTitle>
            <DialogDescription>
              事件将以 HMAC 签名投递到回调地址；签名密钥在创建后仅展示一次。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitCreate}>
            <FormField label="回调 URL" error={form.formState.errors.url?.message} htmlFor="whk-url">
              <Input id="whk-url" placeholder="https://example.com/webhook" {...form.register('url')} />
            </FormField>
            <FormField label="备注（可选）" error={form.formState.errors.description?.message} htmlFor="whk-desc">
              <Input id="whk-desc" placeholder="用途说明，便于识别" {...form.register('description')} />
            </FormField>
            <FormField label="事件类型" error={form.formState.errors.events?.message}>
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
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{ev.type}</code>
                        {ev.description && <span className="ml-2 text-xs text-muted-foreground">{ev.description}</span>}
                      </span>
                    </label>
                  )
                })}
                {eventsQ.isPending && <p className="text-xs text-muted-foreground">加载事件目录…</p>}
              </div>
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? '创建中…' : '创建订阅'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 一次性签名密钥（创建/轮换共用：明文只显示一次） */}
      <SecretModal
        open={secret !== null}
        onOpenChange={(o) => !o && closeSecret()}
        secretName="Webhook 签名密钥"
        secretValue={secret ?? ''}
        title={secretTitle}
      />
    </div>
  )
}

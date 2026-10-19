
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageHeader, PageLoading } from '../../components/Page';
import { SettingsCard } from '../../components/SettingsCard';
import { toast } from '../../components/toast';
import { Badge } from '../../components/ui/badge'
import { Item, ItemActions, ItemContent, ItemTitle } from '../../components/ui/item';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui/tabs';
import { useApi } from '@ploykit/hooks';
import { formatDateTime, shortID, statusLabel } from '../../lib/utils';
import {
  ADMIN_PAGE_SIZE,
  adminError,
  adminListQuery,
  formatCents,
  type AdminListEnvelope,
} from './shared';


interface AdminOrderRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  user_id: string;
  plan_code: string;
  interval: string;
  amount_cents: number;
  currency: string;
  channel: string;
  status: string;
  channel_ref?: string;
  paid_at?: string;
  canceled_at?: string;
  refunded_at?: string;
  created_at: string;
}


interface AdminPaymentEventRow {
  id: string;
  channel: string;
  channel_event_id: string;
  event_type: string;
  order_id?: string;
  process_status: string;
  process_error?: string;
  processed_at?: string;
  processed: boolean;
  created_at: string;
}


interface AdminBillingChannelRow {
  name: string;
  configured: boolean;
  key_masked: string;
  webhook_configured: boolean;
}


interface AdminBillingConfigEnvelope {
  channels: AdminBillingChannelRow[];
}


const ORDER_STATUSES = ['pending', 'paid', 'failed', 'canceled', 'refunded'];


function orderStatusLabel(s: string): string {
  if (s === 'refunded') return '已退款';
  return statusLabel(s);
}


const PROCESS_STATUS_LABEL: Record<string, string> = {
  processed: '已处理',
  pending: '待处理',
  error: '处理出错',
};

export function OrdersPage() {
  const api = useApi();
  const qc = useQueryClient();
  const confirm = useConfirm();
  
  
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status') ?? '';
  const status = ORDER_STATUSES.includes(statusParam) ? statusParam : '';
  const orderPage = Math.max(
    1,
    Number.parseInt(searchParams.get('page') ?? '1', 10) || 1,
  );
  const setOrderFilter = (nextStatus: string, nextPage = 1) => {
    const p = new URLSearchParams(searchParams);
    if (nextStatus) p.set('status', nextStatus);
    else p.delete('status');
    if (nextPage > 1) p.set('page', String(nextPage));
    else p.delete('page');
    setSearchParams(p, { replace: true });
  };
  const [eventPage, setEventPage] = useState(1);

  const ordersQ = useQuery({
    queryKey: ['admin', 'orders', orderPage, status],
    queryFn: () =>
      api.get<AdminListEnvelope<AdminOrderRow>>(
        `/api/admin/orders${adminListQuery(orderPage, ADMIN_PAGE_SIZE, { status })}`,
      ),
  });
  const eventsQ = useQuery({
    queryKey: ['admin', 'payment-events', eventPage],
    queryFn: () =>
      api.get<AdminListEnvelope<AdminPaymentEventRow>>(
        `/api/admin/payment-events${adminListQuery(eventPage, ADMIN_PAGE_SIZE)}`,
      ),
  });

  
  const channelsQ = useQuery({
    queryKey: ['admin', 'billing-config'],
    queryFn: () =>
      api.get<AdminBillingConfigEnvelope>('/api/admin/billing/config'),
  });

  
  const [testingChannel, setTestingChannel] = useState('');
  const testConnM = useMutation({
    mutationFn: (channel: string) =>
      api.post('/api/admin/billing/test-connection', { channel }),
    onMutate: (channel) => setTestingChannel(channel),
    onSettled: () => setTestingChannel(''),
    onSuccess: (_d, channel) => toast.success(`${channel} 连接正常`),
    onError: (e, channel) =>
      toast.error(adminError(e, `${channel} 连接测试失败`)),
  });

  const cancelM = useMutation({
    mutationFn: (o: AdminOrderRow) => api.delete(`/api/admin/orders/${o.id}`),
    onSuccess: (_d, o) => {
      toast.success(`订单 ${shortID(o.id)} 已取消`);
      void qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (e) => toast.error(adminError(e, '订单取消失败')),
  });

  
  
  
  const markPaidM = useMutation({
    mutationFn: (o: AdminOrderRow) =>
      api.post(`/api/admin/billing/orders/${o.id}/mark-paid`),
    onSuccess: (_d, o) => {
      toast.success(`订单 ${shortID(o.id)} 已核销（manual 标记已付）`);
      void qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (e) => toast.error(adminError(e, '标记已付失败')),
  });

  
  const expiryM = useMutation({
    mutationFn: () =>
      api.post<{ expired: number }>('/api/admin/billing/run-expiry'),
    onSuccess: (d) =>
      toast.success(`本轮到期降级完成：降级 ${d?.expired ?? 0} 个工作区`),
    onError: (e) => toast.error(adminError(e, '到期降级触发失败')),
  });

  
  const overageM = useMutation({
    mutationFn: () =>
      api.post<{ orders_created: number }>('/api/admin/billing/run-overage'),
    onSuccess: (d) =>
      toast.success(`本轮超额出账完成：新建 ${d?.orders_created ?? 0} 笔订单`),
    onError: (e) => toast.error(adminError(e, '超额出账触发失败')),
  });

  const onCancelOrder = async (o: AdminOrderRow) => {
    const ok = await confirm({
      title: '取消订单',
      description: `将取消 ${o.workspace_name} 的 ${formatCents(o.amount_cents, o.currency)} 订单（${shortID(o.id)}）。仅 pending 订单可取消。`,
      confirmText: '取消订单',
      danger: true,
    });
    if (ok) cancelM.mutate(o);
  };

  
  const onMarkPaid = async (o: AdminOrderRow) => {
    const ok = await confirm({
      title: '标记已付（manual 核销）',
      description: `确认已线下收到 ${o.workspace_name} 的 ${formatCents(o.amount_cents, o.currency)}（订单 ${shortID(o.id)}，渠道 manual）？标记后 pending→paid 并发 billing.order_marked_paid 事件。`,
      confirmText: '标记已付',
      danger: true,
    });
    if (ok) markPaidM.mutate(o);
  };

  
  
  const onRunExpiry = async () => {
    const ok = await confirm({
      title: '触发一轮到期降级',
      description:
        '将立即扫描全部工作区，把订阅已到期的工作区降级为免费套餐——命中的工作区即刻失去付费能力（用户可重新购买恢复）。扫描幂等，可重复执行；操作计入平台审计日志。',
      confirmText: '执行降级扫描',
      danger: true,
    });
    if (ok) expiryM.mutate();
  };

  const onRunOverage = async () => {
    const ok = await confirm({
      title: '触发一轮超额出账',
      description:
        '将立即为全部超额工作区按当前用量创建计量账单订单（真实出账，用户会看到新的待支付订单）。操作幂等，可重复执行；结果计入平台审计日志。',
      confirmText: '执行出账',
      danger: true,
    });
    if (ok) overageM.mutate();
  };

  const orders = ordersQ.data?.items ?? [];
  const ordersTotal = ordersQ.data?.total ?? 0;

  const orderColumns: Column<AdminOrderRow>[] = [
    {
      key: 'workspace',
      header: '工作区',
      render: (o) => (
        
        <div className="min-w-0 max-w-[16rem]">
          <p className="truncate font-medium">{o.workspace_name || '—'}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            <Tooltip>
              <TooltipTrigger render={<span tabIndex={0} className="cursor-help" />}>
                {shortID(o.workspace_id)}
              </TooltipTrigger>
              <TooltipContent>{o.workspace_id}</TooltipContent>
            </Tooltip>
          </p>
        </div>
      ),
    },
    {
      key: 'plan',
      header: '套餐 / 周期',
      className: 'w-32',
      render: (o) => (
        <div className="min-w-0 max-w-[12rem]">
          <p className="truncate">{o.plan_code}</p>
          <p className="truncate text-xs text-muted-foreground">{o.interval}</p>
        </div>
      ),
    },
    {
      key: 'amount_cents',
      header: '金额',
      className: 'w-28',
      render: (o) => (
        <span className="whitespace-nowrap font-medium tabular-nums">
          {formatCents(o.amount_cents, o.currency)}
        </span>
      ),
    },
    {
      key: 'channel',
      header: '渠道',
      className: 'w-24',
      render: (o) => <span className="text-muted-foreground">{o.channel}</span>,
    },
    {
      key: 'status',
      header: '状态',
      className: 'w-24',
      render: (o) => <StatusBadge status={o.status} />,
    },
    {
      key: 'created_at',
      header: '创建时间',
      className: 'w-44',
      render: (o) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(o.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      className: 'w-36',
      render: (o) => (
        <div className="flex items-center justify-end gap-1.5">
          {/* 批次 2.8：pending 且 channel=manual 的行可核销（标记已付）；
              stripe 等渠道订单不出现（核销 = 绕过渠道记账，服务端 400 兜底）。 */}
          {o.status === 'pending' && o.channel === 'manual' && (
            <Tooltip>
              {/* disabled 按钮不派发指针事件，Tooltip 的 Trigger 需包一层 span */}
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={markPaidM.isPending}
                  onClick={() => void onMarkPaid(o)}
                >
                  标记已付
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                线下收款确认后核销：pending→paid，并发 billing.order_marked_paid 事件
              </TooltipContent>
            </Tooltip>
          )}
          {o.status !== 'pending' ? (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                  onClick={() => void onCancelOrder(o)}
                >
                  取消
                </Button>
              </TooltipTrigger>
              <TooltipContent>仅 pending 订单可取消</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={cancelM.isPending}
              onClick={() => void onCancelOrder(o)}
            >
              取消
            </Button>
          )}
        </div>
      ),
    },
  ];

  const events = eventsQ.data?.items ?? [];
  const eventsTotal = eventsQ.data?.total ?? 0;

  const eventColumns: Column<AdminPaymentEventRow>[] = [
    {
      key: 'channel',
      header: '渠道 / 事件',
      render: (e) => (
        <div className="min-w-0 max-w-[16rem]">
          <p className="truncate">{e.channel}</p>
          <p className="truncate text-xs text-muted-foreground">
            <Badge variant="secondary" className="font-mono">
              {e.event_type}
            </Badge>
          </p>
        </div>
      ),
    },
    {
      key: 'channel_event_id',
      header: '渠道事件 ID',
      className: 'w-40',
      render: (e) => (
        <span className="truncate font-mono text-xs text-muted-foreground">
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} className="cursor-help" />}>
              {shortID(e.channel_event_id)}
            </TooltipTrigger>
            <TooltipContent>{e.channel_event_id}</TooltipContent>
          </Tooltip>
        </span>
      ),
    },
    {
      key: 'order_id',
      header: '关联订单',
      className: 'w-28',
      render: (e) =>
        e.order_id ? (
          <span className="font-mono text-xs">
            <Tooltip>
              <TooltipTrigger render={<span tabIndex={0} className="cursor-help" />}>
                {shortID(e.order_id)}
              </TooltipTrigger>
              <TooltipContent>{e.order_id}</TooltipContent>
            </Tooltip>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'processed',
      header: '处理状态',
      className: 'w-32',
      render: (e) => {
        const label = PROCESS_STATUS_LABEL[e.process_status] ?? e.process_status;
        return (
          <div className="flex min-w-0 items-center gap-1.5">
            {e.processed ? (
              <Badge variant="outline">已处理</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                未处理
              </Badge>
            )}
            {/* B-orders-12：处理状态走中文映射，不再与英文枚举原文双显 */}
            {e.process_status !== 'processed' &&
              (e.process_error ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        tabIndex={0}
                        className="cursor-help truncate text-xs text-muted-foreground"
                      />
                    }
                  >
                    {label}
                  </TooltipTrigger>
                  <TooltipContent>{e.process_error}</TooltipContent>
                </Tooltip>
              ) : (
                <span className="truncate text-xs text-muted-foreground">
                  {label}
                </span>
              ))}
          </div>
        );
      },
    },
    {
      key: 'created_at',
      header: '时间',
      className: 'w-44',
      render: (e) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(e.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="订单"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={expiryM.isPending}
              onClick={() => void onRunExpiry()}
            >
              {expiryM.isPending ? '执行中…' : '触发到期降级'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={overageM.isPending}
              onClick={() => void onRunOverage()}
            >
              {overageM.isPending ? '执行中…' : '触发超额出账'}
            </Button>
          </div>
        }
      />

      <SettingsCard title="支付渠道">
        {channelsQ.isError ? (
          <PageError
            message={adminError(channelsQ.error, '渠道配置加载失败')}
            onRetry={() => void channelsQ.refetch()}
          />
        ) : (
          <div className="space-y-2">
            {channelsQ.isPending && <PageLoading label="加载渠道配置中…" />}
            {(channelsQ.data?.channels ?? []).map((ch) => (
              <Item key={ch.name} variant="outline">
                <ItemContent>
                  <ItemTitle>{ch.name}</ItemTitle>
                </ItemContent>
                {ch.configured ? (
                  <Badge>已配置</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    未配置
                  </Badge>
                )}
                <Tooltip>
                  <TooltipTrigger
                    render={<span tabIndex={0} className="inline-flex cursor-help" />}
                  >
                    <Badge variant="secondary" className="font-mono">
                      {ch.key_masked}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>密钥掩码（原始密钥不可见）</TooltipContent>
                </Tooltip>
                {ch.webhook_configured ? (
                  <Badge variant="outline">webhook 已配置</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    webhook 未配置
                  </Badge>
                )}
                <ItemActions>
                  <Tooltip>
                    {/* disabled 按钮不派发指针事件，Tooltip 的 Trigger 需包一层 span */}
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          !ch.configured ||
                          ch.name === 'manual' ||
                          testConnM.isPending
                        }
                        onClick={() => testConnM.mutate(ch.name)}
                      >
                        {testingChannel === ch.name ? '测试中…' : '测试连接'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {!ch.configured
                        ? '渠道未配置密钥，无法测试'
                        : ch.name === 'manual'
                          ? 'manual 为线下收款渠道，无外部服务可测试连接'
                          : '向渠道发起一次只读连通性请求'}
                    </TooltipContent>
                  </Tooltip>
                </ItemActions>
              </Item>
            ))}
            {!channelsQ.isPending &&
              (channelsQ.data?.channels ?? []).length === 0 && (
                <PageEmpty label="暂无渠道" />
              )}
          </div>
        )}
      </SettingsCard>

      <Tabs defaultValue="orders">
        <TabsList className="mb-4">
          <TabsTrigger value="orders">订单</TabsTrigger>
          <TabsTrigger value="payment-events">支付事件</TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select
              value={status || 'all'}
              onValueChange={(v) => {
                const next =
                  typeof v === 'string' && v !== 'all' ? v : '';
                setOrderFilter(next, 1); 
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-44"
                aria-label="按订单状态过滤"
              >
                <SelectValue>
                  {status ? orderStatusLabel(status) : '全部状态'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="all">全部状态</SelectItem>
                {ORDER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {orderStatusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {ordersQ.isError ? (
            <PageError
              
              message={`${adminError(ordersQ.error, '订单列表加载失败')}；重试仍失败时，请稍后再来或联系平台管理员`}
              onRetry={() => void ordersQ.refetch()}
            />
          ) : (
            <DataTable
              columns={orderColumns}
              rows={orders}
              rowKey={(o) => o.id}
              loading={ordersQ.isPending}
              pagination={{
                page: orderPage,
                pageSize: ADMIN_PAGE_SIZE,
                total: ordersTotal,
                onPageChange: (p) => setOrderFilter(status, p),
              }}
              empty={
                status ? (
                  <PageEmpty
                    label="没有该状态的订单"
                    hint="换个状态或清除过滤"
                  />
                ) : (
                  <PageEmpty
                    label="暂无订单"
                    hint="工作区完成购买后订单会出现在这里"
                  />
                )
              }
            />
          )}
        </TabsContent>

        <TabsContent value="payment-events">
          {eventsQ.isError ? (
            <PageError
              message={adminError(eventsQ.error, '支付事件加载失败')}
              onRetry={() => void eventsQ.refetch()}
            />
          ) : (
            <DataTable
              columns={eventColumns}
              rows={events}
              rowKey={(e) => e.id}
              loading={eventsQ.isPending}
              pagination={{
                page: eventPage,
                pageSize: ADMIN_PAGE_SIZE,
                total: eventsTotal,
                onPageChange: setEventPage,
              }}
              empty={
                <PageEmpty
                  label="暂无支付事件"
                  hint="渠道回调到达后在此可见（含未消费事件）"
                />
              }
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

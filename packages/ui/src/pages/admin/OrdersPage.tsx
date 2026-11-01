
import { useState } from 'react';
import { useSearchParamsCompat } from '../../router';
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
import { useT } from '../../i18n';
import { formatDateTime, shortID } from '../../lib/utils';
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

// i18n（g3 分片）：订单/处理状态文案走字典（en 默认），不再依赖 lib/utils 的
// statusLabel 中文映射；未收录状态回退原始值（与原 statusLabel 兜底一致）。
const ORDER_STATUS_KEYS: Record<string, string> = {
  pending: 'admin.orders.status.pending',
  paid: 'admin.orders.status.paid',
  failed: 'admin.orders.status.failed',
  canceled: 'admin.orders.status.canceled',
  refunded: 'admin.orders.status.refunded',
};

const PROCESS_STATUS_KEYS: Record<string, string> = {
  processed: 'admin.orders.process.processed',
  pending: 'admin.orders.process.pending',
  error: 'admin.orders.process.error',
};

export function OrdersPage() {
  const api = useApi();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const t = useT();
  const orderStatusLabel = (s: string) => {
    const key = ORDER_STATUS_KEYS[s];
    return key ? t(key) : s;
  };
  const processStatusLabel = (s: string) => {
    const key = PROCESS_STATUS_KEYS[s];
    return key ? t(key) : s;
  };
  
  
  const [searchParams, setSearchParams] = useSearchParamsCompat();
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
    onSuccess: (_d, channel) => toast.success(t('admin.orders.toast.connectionOk', { channel })),
    onError: (e, channel) =>
      toast.error(adminError(e, t('admin.orders.toast.connectionTestFailed', { channel }))),
  });

  const cancelM = useMutation({
    mutationFn: (o: AdminOrderRow) => api.delete(`/api/admin/orders/${o.id}`),
    onSuccess: (_d, o) => {
      toast.success(t('admin.orders.toast.orderCanceled', { id: shortID(o.id) }));
      void qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (e) => toast.error(adminError(e, t('admin.orders.toast.orderCancelFailed'))),
  });

  
  
  
  const markPaidM = useMutation({
    mutationFn: (o: AdminOrderRow) =>
      api.post(`/api/admin/billing/orders/${o.id}/mark-paid`),
    onSuccess: (_d, o) => {
      toast.success(t('admin.orders.toast.orderMarkedPaid', { id: shortID(o.id) }));
      void qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (e) => toast.error(adminError(e, t('admin.orders.toast.markPaidFailed'))),
  });

  
  const expiryM = useMutation({
    mutationFn: () =>
      api.post<{ expired: number }>('/api/admin/billing/run-expiry'),
    onSuccess: (d) =>
      toast.success(t('admin.orders.toast.expiryDone', { count: d?.expired ?? 0 })),
    onError: (e) => toast.error(adminError(e, t('admin.orders.toast.expiryFailed'))),
  });

  
  const overageM = useMutation({
    mutationFn: () =>
      api.post<{ orders_created: number }>('/api/admin/billing/run-overage'),
    onSuccess: (d) =>
      toast.success(t('admin.orders.toast.overageDone', { count: d?.orders_created ?? 0 })),
    onError: (e) => toast.error(adminError(e, t('admin.orders.toast.overageFailed'))),
  });

  const onCancelOrder = async (o: AdminOrderRow) => {
    const ok = await confirm({
      title: t('admin.orders.cancelOrder.title'),
      description: t('admin.orders.cancelOrder.desc', {
        workspace: o.workspace_name,
        amount: formatCents(o.amount_cents, o.currency),
        id: shortID(o.id),
      }),
      confirmText: t('admin.orders.cancelOrder.title'),
      danger: true,
    });
    if (ok) cancelM.mutate(o);
  };

  
  const onMarkPaid = async (o: AdminOrderRow) => {
    const ok = await confirm({
      title: t('admin.orders.markPaid.title'),
      description: t('admin.orders.markPaid.desc', {
        workspace: o.workspace_name,
        amount: formatCents(o.amount_cents, o.currency),
        id: shortID(o.id),
      }),
      confirmText: t('admin.orders.markPaid.confirm'),
      danger: true,
    });
    if (ok) markPaidM.mutate(o);
  };

  
  
  const onRunExpiry = async () => {
    const ok = await confirm({
      title: t('admin.orders.runExpiry.title'),
      description: t('admin.orders.runExpiry.desc'),
      confirmText: t('admin.orders.runExpiry.confirm'),
      danger: true,
    });
    if (ok) expiryM.mutate();
  };

  const onRunOverage = async () => {
    const ok = await confirm({
      title: t('admin.orders.runOverage.title'),
      description: t('admin.orders.runOverage.desc'),
      confirmText: t('admin.orders.runOverage.confirm'),
      danger: true,
    });
    if (ok) overageM.mutate();
  };

  const orders = ordersQ.data?.items ?? [];
  const ordersTotal = ordersQ.data?.total ?? 0;

  const orderColumns: Column<AdminOrderRow>[] = [
    {
      key: 'workspace',
      header: t('admin.orders.col.workspace'),
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
      header: t('admin.orders.col.planInterval'),
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
      header: t('admin.orders.col.amount'),
      className: 'w-28',
      render: (o) => (
        <span className="whitespace-nowrap font-medium tabular-nums">
          {formatCents(o.amount_cents, o.currency)}
        </span>
      ),
    },
    {
      key: 'channel',
      header: t('admin.orders.col.channel'),
      className: 'w-24',
      render: (o) => <span className="text-muted-foreground">{o.channel}</span>,
    },
    {
      key: 'status',
      header: t('admin.orders.col.status'),
      className: 'w-24',
      render: (o) => <StatusBadge status={o.status} label={orderStatusLabel(o.status)} />,
    },
    {
      key: 'created_at',
      header: t('admin.orders.col.createdAt'),
      className: 'w-44',
      render: (o) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(o.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('admin.orders.col.actions'),
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
                  {t('admin.orders.markPaid.confirm')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t('admin.orders.actions.markPaidHint')}
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
                  {t('admin.orders.actions.cancel')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('admin.orders.actions.onlyPendingCancelable')}</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={cancelM.isPending}
              onClick={() => void onCancelOrder(o)}
            >
              {t('admin.orders.actions.cancel')}
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
      header: t('admin.orders.col.channelEvent'),
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
      header: t('admin.orders.col.channelEventId'),
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
      header: t('admin.orders.col.relatedOrder'),
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
      header: t('admin.orders.col.processStatus'),
      className: 'w-32',
      render: (e) => {
        const label = processStatusLabel(e.process_status);
        return (
          <div className="flex min-w-0 items-center gap-1.5">
            {e.processed ? (
              <Badge variant="outline">{t('admin.orders.process.processed')}</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                {t('admin.orders.process.unprocessed')}
              </Badge>
            )}
            {/* B-orders-12：处理状态走文案映射（g3 字典），不再与英文枚举原文双显 */}
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
      header: t('admin.orders.col.time'),
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
        title={t('admin.orders.title')}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={expiryM.isPending}
              onClick={() => void onRunExpiry()}
            >
              {expiryM.isPending ? t('admin.orders.running') : t('admin.orders.triggerExpiry')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={overageM.isPending}
              onClick={() => void onRunOverage()}
            >
              {overageM.isPending ? t('admin.orders.running') : t('admin.orders.triggerOverage')}
            </Button>
          </div>
        }
      />

      <SettingsCard title={t('admin.orders.channels.title')}>
        {channelsQ.isError ? (
          <PageError
            message={adminError(channelsQ.error, t('admin.orders.channels.loadFailed'))}
            onRetry={() => void channelsQ.refetch()}
          />
        ) : (
          <div className="space-y-2">
            {channelsQ.isPending && <PageLoading label={t('admin.orders.channels.loading')} />}
            {(channelsQ.data?.channels ?? []).map((ch) => (
              <Item key={ch.name} variant="outline">
                <ItemContent>
                  <ItemTitle>{ch.name}</ItemTitle>
                </ItemContent>
                {ch.configured ? (
                  <Badge>{t('admin.orders.channels.configured')}</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    {t('admin.orders.channels.notConfigured')}
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
                  <TooltipContent>{t('admin.orders.channels.keyMaskedHint')}</TooltipContent>
                </Tooltip>
                {ch.webhook_configured ? (
                  <Badge variant="outline">{t('admin.orders.channels.webhookConfigured')}</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    {t('admin.orders.channels.webhookNotConfigured')}
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
                        {testingChannel === ch.name ? t('admin.orders.channels.testing') : t('admin.orders.channels.test')}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {!ch.configured
                        ? t('admin.orders.channels.testHintNoKey')
                        : ch.name === 'manual'
                          ? t('admin.orders.channels.testHintManual')
                          : t('admin.orders.channels.testHintDefault')}
                    </TooltipContent>
                  </Tooltip>
                </ItemActions>
              </Item>
            ))}
            {!channelsQ.isPending &&
              (channelsQ.data?.channels ?? []).length === 0 && (
                <PageEmpty label={t('admin.orders.channels.empty')} />
              )}
          </div>
        )}
      </SettingsCard>

      <Tabs defaultValue="orders">
        <TabsList className="mb-4">
          <TabsTrigger value="orders">{t('admin.orders.tabs.orders')}</TabsTrigger>
          <TabsTrigger value="payment-events">{t('admin.orders.tabs.paymentEvents')}</TabsTrigger>
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
                aria-label={t('admin.orders.filter.statusAria')}
              >
                <SelectValue>
                  {status ? orderStatusLabel(status) : t('admin.orders.filter.allStatuses')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="all">{t('admin.orders.filter.allStatuses')}</SelectItem>
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

              message={`${adminError(ordersQ.error, t('admin.orders.orders.loadFailed'))}${t('admin.orders.orders.errorSuffix')}`}
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
                    label={t('admin.orders.empty.filteredLabel')}
                    hint={t('admin.orders.empty.filteredHint')}
                  />
                ) : (
                  <PageEmpty
                    label={t('admin.orders.empty.label')}
                    hint={t('admin.orders.empty.hint')}
                  />
                )
              }
            />
          )}
        </TabsContent>

        <TabsContent value="payment-events">
          {eventsQ.isError ? (
            <PageError
              message={adminError(eventsQ.error, t('admin.orders.events.loadFailed'))}
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
                  label={t('admin.orders.events.emptyLabel')}
                  hint={t('admin.orders.events.emptyHint')}
                />
              }
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

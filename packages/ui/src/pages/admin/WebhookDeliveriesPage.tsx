
import { useState } from 'react';
import { useSearchParamsCompat } from '../../router';
import { RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageHeader } from '../../components/Page';
import { toast } from '../../components/toast';
import { Badge } from '../../components/ui/badge'
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useApi } from '@ploykit/hooks';
import { formatDateTime, shortID, statusLabel } from '../../lib/utils';
import { useT } from '../../i18n';
import {
  ADMIN_PAGE_SIZE,
  adminError,
  adminListQuery,
  type AdminListEnvelope,
} from './shared';


interface AdminWebhookDeliveryRow {
  id: string;
  workspace_id: string;
  url: string;
  subscription_id: string;
  event_id: string;
  event_type: string;
  status: string;
  attempts: number;
  last_status_code?: number;
  last_error?: string;
  delivered_at?: string;
  created_at: string;
}


const DELIVERY_STATUSES = ['pending', 'delivered', 'dead'];


const LIST_REFETCH_MS = 30_000;


const COUNT_STALE_MS = 60_000;

export function WebhookDeliveriesPage() {
  const api = useApi();
  const qc = useQueryClient();
  const t = useT();
  
  const [searchParams, setSearchParams] = useSearchParamsCompat();
  const statusParam = searchParams.get('status') ?? '';
  const status = DELIVERY_STATUSES.includes(statusParam) ? statusParam : '';
  const page = Math.max(
    1,
    Number.parseInt(searchParams.get('page') ?? '1', 10) || 1,
  );
  const setFilter = (nextStatus: string, nextPage = 1) => {
    const p = new URLSearchParams(searchParams);
    if (nextStatus) p.set('status', nextStatus);
    else p.delete('status');
    if (nextPage > 1) p.set('page', String(nextPage));
    else p.delete('page');
    setSearchParams(p, { replace: true });
  };

  const listQ = useQuery({
    queryKey: ['admin', 'webhook-deliveries', page, status],
    queryFn: () =>
      api.get<AdminListEnvelope<AdminWebhookDeliveryRow>>(
        `/api/admin/webhook-deliveries${adminListQuery(page, ADMIN_PAGE_SIZE, { status })}`,
      ),
    
    refetchInterval: LIST_REFETCH_MS,
  });

  
  
  const countQuery = (s: string) => ({
    queryKey: ['admin', 'webhook-deliveries-count', s],
    queryFn: () =>
      api.get<AdminListEnvelope<AdminWebhookDeliveryRow>>(
        `/api/admin/webhook-deliveries${adminListQuery(1, 1, { status: s })}`,
      ),
    staleTime: COUNT_STALE_MS,
  });
  const pendingCountQ = useQuery(countQuery('pending'));
  const deliveredCountQ = useQuery(countQuery('delivered'));
  const deadCountQ = useQuery(countQuery('dead'));
  const statusCounts: Record<string, number | undefined> = {
    pending: pendingCountQ.data?.total,
    delivered: deliveredCountQ.data?.total,
    dead: deadCountQ.data?.total,
  };

  
  const redeliverM = useMutation({
    mutationFn: (d: AdminWebhookDeliveryRow) =>
      api.post<AdminWebhookDeliveryRow>(
        `/api/admin/webhook-deliveries/${d.id}/redeliver`,
      ),
    onSuccess: (d2, d) => {

      toast.success(
        t('admin.webhookDeliveries.redelivered', {
          id: shortID(d2?.id ?? ''),
          event: d.event_id,
        }),
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'webhook-deliveries'] });
    },
    onError: (e) =>
      toast.error(adminError(e, t('admin.webhookDeliveries.redeliverFailed'))),
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;

  const columns: Column<AdminWebhookDeliveryRow>[] = [
    {
      key: 'workspace_id',
      header: t('admin.webhookDeliveries.colWorkspace'),
      className: 'w-24',
      render: (d) =>
        d.workspace_id ? (
          <Tooltip>
            <TooltipTrigger
              render={<span tabIndex={0} className="cursor-help font-mono text-xs" />}
            >
              {shortID(d.workspace_id)}
            </TooltipTrigger>
            <TooltipContent>{d.workspace_id}</TooltipContent>
          </Tooltip>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            {t('admin.webhookDeliveries.orphan')}
          </Badge>
        ),
    },
    {
      key: 'url',
      header: t('admin.webhookDeliveries.colTargetUrl'),
      render: (d) =>
        d.url ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <p
                  tabIndex={0}
                  className="max-w-[22rem] cursor-help truncate font-mono text-xs"
                />
              }
            >
              {d.url}
            </TooltipTrigger>
            <TooltipContent>{d.url}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t('admin.webhookDeliveries.subscriptionDeleted')}
          </span>
        ),
    },
    {

      key: 'event_id',
      header: t('admin.webhookDeliveries.colEventId'),
      className: 'w-32',
      render: (d) => (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge
                variant="outline"
                className="block max-w-[8rem] cursor-help truncate font-mono"
              />
            }
          >
            {d.event_id}
          </TooltipTrigger>
          <TooltipContent>{d.event_id}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: 'event_type',
      header: t('admin.webhookDeliveries.colEvent'),
      className: 'w-40',
      render: (d) => (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge
                variant="outline"
                className="block max-w-[10rem] cursor-help truncate font-mono"
              />
            }
          >
            {d.event_type}
          </TooltipTrigger>
          <TooltipContent>{d.event_type}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: 'status',
      header: t('admin.webhookDeliveries.colStatus'),
      className: 'w-24',
      render: (d) => <StatusBadge status={d.status} />,
    },
    {
      key: 'attempts',
      header: t('admin.webhookDeliveries.colAttempts'),
      className: 'w-16 text-right',
      render: (d) => <span className="tabular-nums">{d.attempts}</span>,
    },
    {
      key: 'last_status',
      header: t('admin.webhookDeliveries.colLastResponse'),
      className: 'w-32',
      render: (d) =>
        d.last_status_code ? (
          d.last_error ? (
            <Tooltip>
              <TooltipTrigger
                render={<span tabIndex={0} className="cursor-help font-mono text-xs" />}
              >
                {d.last_status_code}
              </TooltipTrigger>
              <TooltipContent>{d.last_error}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="font-mono text-xs">{d.last_status_code}</span>
          )
        ) : d.last_error ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  className="block max-w-[12rem] cursor-help truncate text-xs text-destructive"
                />
              }
            >
              {d.last_error}
            </TooltipTrigger>
            <TooltipContent>{d.last_error}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'created_at',
      header: t('admin.webhookDeliveries.colTime'),
      className: 'w-44',
      render: (d) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(d.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('admin.webhookDeliveries.colAction'),
      className: 'w-20',
      render: (d) => {
        // 行级 pending：仅禁用正在重投的行（react-query variables 记录当前 mutate 入参）
        const redeploying = redeliverM.isPending && redeliverM.variables?.id === d.id;
        return (
          <Button
            variant="outline"
            size="sm"
            disabled={redeploying}
            onClick={() => redeliverM.mutate(d)}
          >
            {redeploying && <Spinner className="size-3" aria-hidden="true" />}
            {t('admin.webhookDeliveries.redeliver')}
          </Button>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title="Webhooks" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={status || 'all'}
          onValueChange={(v) => {

            setFilter(typeof v === 'string' && v !== 'all' ? v : '', 1);
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-44"
            aria-label={t('admin.webhookDeliveries.filterAria')}
          >
            <SelectValue>
              {status ? statusLabel(status) : t('admin.webhookDeliveries.allStatuses')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="all">
              {t('admin.webhookDeliveries.allStatuses')}
            </SelectItem>
            {DELIVERY_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {/* B-webhook-7：选项内联计数（dead (7)）给积压规模语境 */}
                {statusLabel(s)}
                {typeof statusCounts[s] === 'number' ? ` (${statusCounts[s]})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* B-webhook-2：手动刷新出口（观测页等待无需 F5） */}
        <Button
          variant="outline"
          size="sm"
          disabled={listQ.isFetching}
          onClick={() => void listQ.refetch()}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {listQ.isFetching
            ? t('admin.webhookDeliveries.refreshing')
            : t('admin.webhookDeliveries.refresh')}
        </Button>
      </div>

      {listQ.isError ? (
        <PageError
          message={adminError(listQ.error, t('admin.webhookDeliveries.loadFailed'))}
          onRetry={() => void listQ.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(d) => d.id}
          loading={listQ.isPending}
          pagination={{
            page,
            pageSize: ADMIN_PAGE_SIZE,
            total,
            onPageChange: (p) => setFilter(status, p),
          }}
          empty={
            status ? (
              <PageEmpty
                label={t('admin.webhookDeliveries.emptyFilteredLabel')}
                hint={t('admin.webhookDeliveries.emptyFilteredHint')}
              />
            ) : (
              <PageEmpty
                label={t('admin.webhookDeliveries.emptyLabel')}
                hint={t('admin.webhookDeliveries.emptyHint')}
              />
            )
          }
        />
      )}
    </div>
  );
}


import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageHeader } from '../../components/Page';
import { toast } from '../../components/toast';
import { Badge } from '../../components/ui/badge'
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useApi } from '@ploykit/hooks';
import { formatDateTime, shortID, statusLabel } from '../../lib/utils';
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
  
  const [searchParams, setSearchParams] = useSearchParams();
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
      
      toast.success(`已重新入队（新投递 ${shortID(d2?.id ?? '')}，溯源 ${d.event_id}.r）`);
      void qc.invalidateQueries({ queryKey: ['admin', 'webhook-deliveries'] });
    },
    onError: (e) => toast.error(adminError(e, '重投失败')),
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const pastEnd = !listQ.isPending && items.length === 0 && page > 1;

  const columns: Column<AdminWebhookDeliveryRow>[] = [
    {
      key: 'workspace_id',
      header: '工作区',
      className: 'w-24',
      render: (d) =>
        d.workspace_id ? (
          <span className="font-mono text-xs" title={d.workspace_id}>
            {shortID(d.workspace_id)}
          </span>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            孤儿
          </Badge>
        ),
    },
    {
      key: 'url',
      header: '目标 URL',
      render: (d) =>
        d.url ? (
          <p className="max-w-[22rem] truncate font-mono text-xs" title={d.url}>
            {d.url}
          </p>
        ) : (
          <span className="text-xs text-muted-foreground">（订阅已删除）</span>
        ),
    },
    {
      
      key: 'event_id',
      header: '事件 ID',
      className: 'w-32',
      render: (d) => (
        <code
          className="block max-w-[8rem] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
          title={d.event_id}
        >
          {d.event_id}
        </code>
      ),
    },
    {
      key: 'event_type',
      header: '事件',
      className: 'w-40',
      render: (d) => (
        <code
          className="block max-w-[10rem] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
          title={d.event_type}
        >
          {d.event_type}
        </code>
      ),
    },
    {
      key: 'status',
      header: '状态',
      className: 'w-24',
      render: (d) => <StatusBadge status={d.status} />,
    },
    {
      key: 'attempts',
      header: '尝试',
      className: 'w-16 text-right',
      render: (d) => <span className="tabular-nums">{d.attempts}</span>,
    },
    {
      key: 'last_status',
      header: '最近响应',
      className: 'w-32',
      render: (d) =>
        d.last_status_code ? (
          <span className="font-mono text-xs" title={d.last_error ?? undefined}>
            {d.last_status_code}
          </span>
        ) : d.last_error ? (
          
          
          <span
            className="block max-w-[12rem] truncate text-xs text-destructive"
            title={d.last_error}
          >
            {d.last_error}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'created_at',
      header: '时间',
      className: 'w-44',
      render: (d) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(d.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      className: 'w-20',
      render: (d) => (
        <Button
          variant="outline"
          size="sm"
          disabled={redeliverM.isPending}
          onClick={() => redeliverM.mutate(d)}
        >
          重投
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Webhooks"
        
        description="所有工作区的 Webhook 投递与重试记录，按时间倒序"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={status || 'all'}
          onValueChange={(v) => {
            
            setFilter(typeof v === 'string' && v !== 'all' ? v : '', 1);
          }}
        >
          <SelectTrigger size="sm" className="w-44" aria-label="按投递状态过滤">
            <SelectValue>
              {status ? statusLabel(status) : '全部状态'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="all">全部状态</SelectItem>
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
          {listQ.isFetching ? '刷新中…' : '刷新'}
        </Button>
      </div>

      {listQ.isError ? (
        <PageError
          message={adminError(listQ.error, '投递列表加载失败')}
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
            pastEnd ? (
              <div className="flex flex-col items-center gap-2">
                <PageEmpty label="没有更多投递了" hint="当前页数据可能已被删除" />
                <Button variant="outline" size="sm" onClick={() => setFilter(status, 1)}>
                  返回第一页
                </Button>
              </div>
            ) : status ? (
              <PageEmpty label="没有该状态的投递" hint="换个状态或清除过滤" />
            ) : (
              <PageEmpty
                label="暂无投递记录"
                hint="工作区触发事件后，订阅投递会在此出现"
              />
            )
          }
        />
      )}
    </div>
  );
}

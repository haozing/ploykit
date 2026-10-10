
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@ploykit/client';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageHeader } from '../../components/Page';
import { toast } from '../../components/toast';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useApi } from '@ploykit/hooks';
import { formatDate } from '../../lib/utils';
import {
  ADMIN_PAGE_SIZE,
  adminError,
  adminListQuery,
  type AdminListEnvelope,
} from './shared';

type AdminWorkspace = components['schemas']['AdminWorkspace'];


interface AdminPlanView {
  code: string;
  name: string;
  currency: string;
  trial_days: number;
  sort_no: number;
}


const FALLBACK_PLAN_CODES = ['free'];

export function WorkspacesPage() {
  const api = useApi();
  const qc = useQueryClient();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const page = Math.max(
    1,
    Number.parseInt(searchParams.get('page') ?? '1', 10) || 1,
  );
  const applyFilter = (nextQ: string, nextPage: number) => {
    const sp = new URLSearchParams(searchParams);
    if (nextQ) sp.set('q', nextQ);
    else sp.delete('q');
    if (nextPage > 1) sp.set('page', String(nextPage));
    else sp.delete('page');
    setSearchParams(sp, { replace: true });
  };
  const setPage = (p: number) => applyFilter(q, p);
  
  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => {
      const next = searchInput.trim();
      if (next !== q) applyFilter(next, 1);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const wsQ = useQuery({
    queryKey: ['admin', 'workspaces', page, q],
    queryFn: () =>
      api.get<AdminListEnvelope<AdminWorkspace>>(
        `/api/admin/workspaces${adminListQuery(page, ADMIN_PAGE_SIZE, { q })}`,
      ),
  });

  
  
  
  
  const plansQ = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () =>
      api.get<{ items: string[]; plans?: AdminPlanView[] }>('/api/admin/plans'),
  });
  const planCodes = plansQ.data?.items?.length
    ? plansQ.data.items
    : FALLBACK_PLAN_CODES;
  
  
  const planName = new Map(
    (plansQ.data?.plans ?? [])
      .filter((p) => p.name)
      .map((p) => [p.code, p.name] as const),
  );
  const planTrial = new Map(
    (plansQ.data?.plans ?? [])
      .filter((p) => p.trial_days > 0)
      .map((p) => [p.code, p.trial_days] as const),
  );
  
  
  const planLabel = (code: string) => {
    const name = planName.get(code) ?? code;
    return planTrial.has(code)
      ? `${name}（新订阅享 ${planTrial.get(code)} 天试用）`
      : name;
  };

  const planM = useMutation({
    mutationFn: (v: { ws: AdminWorkspace; planCode: string }) =>
      api.patch(`/api/admin/workspaces/${v.ws.id}/plan`, {
        plan_code: v.planCode,
      }),
    onSuccess: (_d, v) => {
      toast.success(
        `${v.ws.name} 套餐已变更为 ${planLabel(v.planCode)}`,
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'workspaces'] });
      
      void qc.invalidateQueries({ queryKey: ['admin', 'workspace'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (e) => toast.error(adminError(e, '套餐变更失败')),
  });

  const raw = wsQ.data?.items ?? [];
  const total = wsQ.data?.total ?? 0;
  
  const pastEnd = !wsQ.isPending && raw.length === 0 && page > 1;

  const columns: Column<AdminWorkspace>[] = [
    {
      key: 'name',
      header: '工作区',
      render: (ws) => (
        
        
        <div className="min-w-0 max-w-[24rem]">
          <p className="truncate font-medium">
            {/* 工作区名 = 详情入口（/admin/workspaces/:id：成员/配额/删除操作面） */}
            <Link
              to={`/admin/workspaces/${ws.id}`}
              className="transition-colors hover:text-primary hover:underline"
            >
              {ws.name}
            </Link>
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {ws.slug}
          </p>
        </div>
      ),
    },
    {
      key: 'owner_email',
      header: '属主',
      
      
      className: 'w-48',
      render: (ws) => (
        <span className="truncate text-muted-foreground" title={ws.owner_email ?? undefined}>
          {ws.owner_email ?? '—'}
        </span>
      ),
    },
    {
      key: 'plan_code',
      header: '套餐',
      className: 'w-44',
      render: (ws) => {
        const mutating = planM.isPending && planM.variables?.ws.id === ws.id;
        const known = planCodes.includes(ws.plan_code);
        return (
          <div className="flex items-center gap-2">
            <Select
              value={ws.plan_code}
              onValueChange={(v) => {
                if (typeof v === 'string' && v !== ws.plan_code)
                  planM.mutate({ ws, planCode: v });
              }}
            >
              <SelectTrigger
                size="sm"
                className="max-md:h-10"
                disabled={mutating}
                aria-label={`变更 ${ws.name} 套餐`}
              >
                <SelectValue>{planLabel(ws.plan_code)}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                {planCodes.map((code) => (
                  <SelectItem key={code} value={code}>
                    {planLabel(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* 非目录码：原值仍可见（Select 显示原 plan_code），打标提示 */}
            {!known && (
              <Badge variant="outline" className="text-muted-foreground">
                未知套餐
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: 'member_count',
      header: '成员数',
      className: 'w-20',
      render: (ws) => <span className="tabular-nums">{ws.member_count}</span>,
    },
    {
      key: 'created_at',
      header: '创建时间',
      className: 'w-28',
      render: (ws) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDate(ws.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="工作区"
        description="平台全部工作区；支持名称/slug 搜索，行内可直接变更套餐（审计留痕）"
      />

      {/* B-workspaces-4：跨页找工作区不再只能逐页手翻（服务端 ilike 检索）。 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="w-72"
          placeholder="按名称 / slug 前缀搜索…"
          aria-label="搜索工作区"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilter(searchInput.trim(), 1);
          }}
        />
        {q && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput('');
              applyFilter('', 1);
            }}
          >
            清除搜索
          </Button>
        )}
      </div>

      {wsQ.isError ? (
        <PageError
          message={adminError(wsQ.error, '工作区列表加载失败')}
          onRetry={() => void wsQ.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={raw}
          rowKey={(ws) => ws.id}
          loading={wsQ.isPending}
          pagination={{
            page,
            pageSize: ADMIN_PAGE_SIZE,
            total,
            onPageChange: setPage,
          }}
          empty={
            
            pastEnd ? (
              <div className="flex flex-col items-center gap-2">
                <PageEmpty label="没有更多工作区了" hint="当前页数据可能已被删除" />
                <Button variant="outline" size="sm" onClick={() => setPage(1)}>
                  返回第一页
                </Button>
              </div>
            ) : q ? (
              <PageEmpty label="没有匹配的工作区" hint="换个关键词或清除搜索" />
            ) : (
              <PageEmpty label="暂无工作区" />
            )
          }
        />
      )}
    </div>
  );
}

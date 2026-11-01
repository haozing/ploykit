
import { useEffect, useState } from 'react';
import { Link, useSearchParamsCompat } from '../../router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@ploykit/client';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageHeader } from '../../components/Page';
import { toast } from '../../components/toast';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../components/ui/tooltip';
import { useApi } from '@ploykit/hooks';
import { formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
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
  const t = useT();
  
  const [searchParams, setSearchParams] = useSearchParamsCompat();
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
    const trialDays = planTrial.get(code);
    return trialDays !== undefined
      ? t('admin.workspaces.planTrialLabel', { name, days: trialDays })
      : name;
  };

  const planM = useMutation({
    mutationFn: (v: { ws: AdminWorkspace; planCode: string }) =>
      api.patch(`/api/admin/workspaces/${v.ws.id}/plan`, {
        plan_code: v.planCode,
      }),
    onSuccess: (_d, v) => {
      toast.success(
        t('admin.workspaces.planChanged', {
          workspace: v.ws.name,
          plan: planLabel(v.planCode),
        }),
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'workspaces'] });

      void qc.invalidateQueries({ queryKey: ['admin', 'workspace'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (e) =>
      toast.error(adminError(e, t('admin.workspaces.planChangeFailed'))),
  });

  const raw = wsQ.data?.items ?? [];
  const total = wsQ.data?.total ?? 0;

  const columns: Column<AdminWorkspace>[] = [
    {
      key: 'name',
      header: t('admin.workspaces.colWorkspace'),
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
      header: t('admin.workspaces.colOwner'),
      
      
      className: 'w-48',
      render: (ws) =>
        ws.owner_email ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  className="block max-w-full cursor-help truncate text-muted-foreground"
                />
              }
            >
              {ws.owner_email}
            </TooltipTrigger>
            <TooltipContent>{ws.owner_email}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'plan_code',
      header: t('admin.workspaces.colPlan'),
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
                aria-label={t('admin.workspaces.changePlanAria', { name: ws.name })}
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
                {t('admin.workspaces.unknownPlan')}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: 'member_count',
      header: t('admin.workspaces.colMembers'),
      className: 'w-20',
      render: (ws) => <span className="tabular-nums">{ws.member_count}</span>,
    },
    {
      key: 'created_at',
      header: t('admin.workspaces.colCreated'),
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
      <PageHeader title={t('admin.workspaces.title')} />

      {/* B-workspaces-4：跨页找工作区不再只能逐页手翻（服务端 ilike 检索）。 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="w-72"
          placeholder={t('admin.workspaces.searchPlaceholder')}
          aria-label={t('admin.workspaces.searchAria')}
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
            {t('admin.workspaces.clearSearch')}
          </Button>
        )}
      </div>

      {wsQ.isError ? (
        <PageError
          message={adminError(wsQ.error, t('admin.workspaces.loadFailed'))}
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
            q ? (
              <PageEmpty
                label={t('admin.workspaces.emptyFilteredLabel')}
                hint={t('admin.workspaces.emptyFilteredHint')}
              />
            ) : (
              <PageEmpty label={t('admin.workspaces.emptyLabel')} />
            )
          }
        />
      )}
    </div>
  );
}

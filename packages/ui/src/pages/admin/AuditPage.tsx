
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Download, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@ploykit/client';
import type { components } from '@ploykit/client';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageHeader } from '../../components/Page';
import { toast } from '../../components/toast';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useApi } from '@ploykit/hooks';
import { apiErrorMessage } from '../../lib/api-error';
import { shortID, formatDateTime } from '../../lib/utils';
import { ADMIN_PAGE_SIZE, adminError } from './shared';

type AuditEvent = components['schemas']['AuditEvent'];
type AuditListResponse = components['schemas']['AuditListResponse'];

interface FilterDraft {
  workspace: string;
  action: string;
  actor: string;
  actorId: string;
  from: string;
  to: string;
}

const emptyDraft: FilterDraft = {
  workspace: '',
  action: '',
  actor: '',
  actorId: '',
  from: '',
  to: '',
};


function draftFromParams(p: URLSearchParams): FilterDraft {
  return {
    workspace: p.get('workspace') ?? '',
    action: p.get('action') ?? '',
    actor: p.get('actor') ?? '',
    actorId: p.get('actor_id') ?? '',
    from: p.get('from') ?? '',
    to: p.get('to') ?? '',
  };
}


function paramsFromDraft(d: FilterDraft, page: number): URLSearchParams {
  const p = new URLSearchParams();
  if (d.workspace.trim()) p.set('workspace', d.workspace.trim());
  if (d.action.trim()) p.set('action', d.action.trim());
  if (d.actor.trim()) p.set('actor', d.actor.trim());
  if (d.actorId.trim()) p.set('actor_id', d.actorId.trim());
  if (d.from) p.set('from', d.from);
  if (d.to) p.set('to', d.to);
  if (page > 1) p.set('page', String(page));
  return p;
}


function auditQueryString(
  d: FilterDraft,
  limit: number,
  offset: number,
  withPaging: boolean,
): string {
  const p = new URLSearchParams();
  if (d.workspace.trim()) p.set('workspace', d.workspace.trim());
  if (d.action.trim()) p.set('action', d.action.trim());
  if (d.actor.trim()) p.set('actor', d.actor.trim());
  if (d.actorId.trim()) p.set('actor_id', d.actorId.trim());
  if (d.from) p.set('from', `${d.from}T00:00:00Z`);
  if (d.to) {
    
    const t = new Date(`${d.to}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    p.set('to', t.toISOString());
  }
  if (withPaging) {
    p.set('limit', String(limit));
    p.set('offset', String(offset));
  }
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export function AuditPage() {
  const api = useApi();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const [draft, setDraft] = useState<FilterDraft>(() =>
    draftFromParams(searchParams),
  );
  
  
  useEffect(() => {
    setDraft(draftFromParams(searchParams));
  }, [searchParams]);
  const applied = useMemo(() => draftFromParams(searchParams), [searchParams]);
  const page = Math.max(
    1,
    Number.parseInt(searchParams.get('page') ?? '1', 10) || 1,
  );
  const [exporting, setExporting] = useState(false);

  const offset = (page - 1) * ADMIN_PAGE_SIZE;
  const auditQ = useQuery({
    queryKey: [
      'admin',
      'audit',
      auditQueryString(applied, ADMIN_PAGE_SIZE, offset, true),
    ],
    queryFn: () =>
      api.get<AuditListResponse>(
        `/api/admin/audit${auditQueryString(applied, ADMIN_PAGE_SIZE, offset, true)}`,
      ),
  });

  
  const onExportCsv = async () => {
    setExporting(true);
    try {
      const blob = await apiFetch<Blob>(
        `/api/admin/audit/export.csv${auditQueryString(applied, 0, 0, false)}`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-admin-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV 导出已开始下载');
    } catch (e) {
      toast.error(apiErrorMessage(e, '导出失败'));
    } finally {
      setExporting(false);
    }
  };

  const apply = () => {
    setSearchParams(paramsFromDraft(draft, 1));
  };

  const items = auditQ.data?.items ?? [];
  const total = auditQ.data?.total ?? 0;
  
  const pastEnd = !auditQ.isPending && items.length === 0 && page > 1;

  const columns: Column<AuditEvent>[] = [
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
    {
      key: 'workspace',
      header: '工作区',
      className: 'w-28',
      render: (e) =>
        e.workspace_id ? (
          <span className="font-mono text-xs" title={e.workspace_id}>
            {shortID(e.workspace_id)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">平台级</span>
        ),
    },
    {
      key: 'actor',
      header: '操作者',
      className: 'w-[22%]',
      render: (e) => {
        const snap = (e.actor_snapshot ?? {}) as { email?: unknown };
        const email = typeof snap.email === 'string' ? snap.email : '';
        return (
          <div className="min-w-0">
            <p className="truncate">{email || e.actor_id || '—'}</p>
            <p className="text-xs text-muted-foreground">{e.actor_type}</p>
          </div>
        );
      },
    },
    {
      key: 'action',
      header: '动作',
      className: 'w-[20%]',
      render: (e) => (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {e.action}
        </code>
      ),
    },
    {
      key: 'resource',
      header: '资源',
      render: (e) => (
        <div className="min-w-0">
          <p className="truncate">{e.resource_type}</p>
          {e.resource_id && (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {e.resource_id}
            </p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="审计"
        description="平台级审计日志（跨工作区；按时间倒序，保留最近事件）"
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">工作区 ID</span>
          <Input
            className="w-56 font-mono"
            placeholder="workspace uuid"
            value={draft.workspace}
            onChange={(e) => setDraft({ ...draft, workspace: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">动作</span>
          <Input
            className="w-44"
            placeholder="如 workspace.rename"
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">操作者邮箱</span>
          <Input
            className="w-48"
            placeholder="邮箱前缀，如 alice@"
            value={draft.actor}
            onChange={(e) => setDraft({ ...draft, actor: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">操作者 ID</span>
          <Input
            className="w-52 font-mono"
            placeholder="actor uuid"
            value={draft.actorId}
            onChange={(e) => setDraft({ ...draft, actorId: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">起始日期</span>
          <Input
            className="w-40"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">结束日期</span>
          <Input
            className="w-40"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <Button onClick={apply}>
          <Search /> 查询
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setDraft(emptyDraft);
            setSearchParams(paramsFromDraft(emptyDraft, 1));
          }}
        >
          重置
        </Button>
        <Button variant="outline" disabled={exporting} onClick={onExportCsv}>
          <Download /> {exporting ? '导出中…' : '导出 CSV'}
        </Button>
      </div>

      {auditQ.isError ? (
        <PageError
          message={adminError(auditQ.error, '审计日志加载失败')}
          onRetry={() => void auditQ.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(e) => e.id}
          loading={auditQ.isPending}
          pagination={{
            page,
            pageSize: ADMIN_PAGE_SIZE,
            total,
            onPageChange: (p) => setSearchParams(paramsFromDraft(applied, p)),
          }}
          empty={
            pastEnd ? (
              <div className="flex flex-col items-center gap-2">
                <PageEmpty label="没有更多审计记录了" hint="当前页数据可能已被轮转删除" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearchParams(paramsFromDraft(applied, 1))}
                >
                  返回第一页
                </Button>
              </div>
            ) : (
              <PageEmpty
                label="暂无审计记录"
                hint="调整过滤条件或触发一些操作后再来"
              />
            )
          }
        />
      )}
    </div>
  );
}

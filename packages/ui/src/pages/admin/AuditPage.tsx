
import { useEffect, useMemo, useState } from 'react';
import { useSearchParamsCompat } from '../../router';
import { Download, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@ploykit/client';
import type { components } from '@ploykit/client';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageHeader } from '../../components/Page';
import { toast } from '../../components/toast';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Field, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { DatePicker } from '../../components/DatePicker';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../components/ui/tooltip';
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

/** 草稿里的 Y-M-D 串 → DatePicker 的本地 Date（空串 → null）。 */
function parseYMD(v: string): Date | null {
  if (!v) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** DatePicker 的本地 Date → 草稿的 Y-M-D 串（null → 空串）。 */
function formatYMD(d: Date | null): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  const [searchParams, setSearchParams] = useSearchParamsCompat();
  
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
          <Tooltip>
            <TooltipTrigger
              render={<span tabIndex={0} className="cursor-help font-mono text-xs" />}
            >
              {shortID(e.workspace_id)}
            </TooltipTrigger>
            <TooltipContent>{e.workspace_id}</TooltipContent>
          </Tooltip>
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
        <Badge variant="outline" className="font-mono">
          {e.action}
        </Badge>
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
      <PageHeader title="审计" />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field className="w-56 gap-1">
          <FieldLabel htmlFor="admin-audit-filter-workspace">工作区 ID</FieldLabel>
          <Input
            id="admin-audit-filter-workspace"
            className="font-mono"
            placeholder="workspace uuid"
            value={draft.workspace}
            onChange={(e) => setDraft({ ...draft, workspace: e.target.value })}
          />
        </Field>
        <Field className="w-44 gap-1">
          <FieldLabel htmlFor="admin-audit-filter-action">动作</FieldLabel>
          <Input
            id="admin-audit-filter-action"
            placeholder="如 workspace.rename"
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
          />
        </Field>
        <Field className="w-48 gap-1">
          <FieldLabel htmlFor="admin-audit-filter-actor">操作者邮箱</FieldLabel>
          <Input
            id="admin-audit-filter-actor"
            placeholder="邮箱前缀，如 alice@"
            value={draft.actor}
            onChange={(e) => setDraft({ ...draft, actor: e.target.value })}
          />
        </Field>
        <Field className="w-52 gap-1">
          <FieldLabel htmlFor="admin-audit-filter-actor-id">操作者 ID</FieldLabel>
          <Input
            id="admin-audit-filter-actor-id"
            className="font-mono"
            placeholder="actor uuid"
            value={draft.actorId}
            onChange={(e) => setDraft({ ...draft, actorId: e.target.value })}
          />
        </Field>
        <Field className="w-40 gap-1">
          <FieldLabel htmlFor="admin-audit-filter-from">起始日期</FieldLabel>
          <DatePicker
            id="admin-audit-filter-from"
            value={parseYMD(draft.from)}
            onChange={(d) => setDraft({ ...draft, from: formatYMD(d) })}
          />
        </Field>
        <Field className="w-40 gap-1">
          <FieldLabel htmlFor="admin-audit-filter-to">结束日期</FieldLabel>
          <DatePicker
            id="admin-audit-filter-to"
            value={parseYMD(draft.to)}
            onChange={(d) => setDraft({ ...draft, to: formatYMD(d) })}
          />
        </Field>
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
            <PageEmpty
              label="暂无审计记录"
              hint="调整过滤条件或触发一些操作后再来"
            />
          }
        />
      )}
    </div>
  );
}

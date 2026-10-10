
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Download, Search } from 'lucide-react'
import { PageHeader, PageLoading, PageError, PageEmpty } from '../../components/Page'
import { DataTable, type Column } from '../../components/DataTable'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { toast } from '../../components/toast'
import {
  useAudit, exportAuditCsv,
  type AuditFilters, type PKAuditEvent,
} from '@ploykit/hooks'
import { formatDateTime } from '../../lib/utils'
import { apiErrorMessage } from '../../lib/api-error'

const PAGE_SIZE = 20


interface FilterDraft {
  action: string
  actorId: string
  resourceType: string
  from: string
  to: string
}


function draftFromParams(p: URLSearchParams): FilterDraft {
  return {
    action: p.get('action') ?? '',
    actorId: p.get('actor_id') ?? '',
    resourceType: p.get('resource_type') ?? '',
    from: p.get('from') ?? '',
    to: p.get('to') ?? '',
  }
}


function paramsFromDraft(d: FilterDraft, offset: number): URLSearchParams {
  const p = new URLSearchParams()
  if (d.action.trim()) p.set('action', d.action.trim())
  if (d.actorId.trim()) p.set('actor_id', d.actorId.trim())
  if (d.resourceType.trim()) p.set('resource_type', d.resourceType.trim())
  if (d.from) p.set('from', d.from)
  if (d.to) p.set('to', d.to)
  if (offset > 0) p.set('offset', String(offset))
  return p
}

function toFilters(d: FilterDraft): AuditFilters {
  return {
    action: d.action.trim(),
    actorId: d.actorId.trim(),
    resourceType: d.resourceType.trim(),
    from: d.from ? `${d.from}T00:00:00Z` : '',
    to: d.to ? `${d.to}T23:59:59Z` : '',
  }
}

export interface WorkspaceAuditPageProps {}

export function WorkspaceAuditPage(_props: WorkspaceAuditPageProps = {}) {
  const [searchParams, setSearchParams] = useSearchParams()
  
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromParams(searchParams))
  
  useEffect(() => {
    setDraft(draftFromParams(searchParams))
  }, [searchParams])
  const [rangeError, setRangeError] = useState<string | null>(null)
  const appliedDraft = useMemo(() => draftFromParams(searchParams), [searchParams])
  const applied = useMemo(() => toFilters(appliedDraft), [appliedDraft])
  const offset = Math.max(0, Number.parseInt(searchParams.get('offset') ?? '0', 10) || 0)

  const { wsId, items, total, loading, error, refetch } = useAudit(applied, PAGE_SIZE, offset)

  const apply = () => {
    
    if (draft.from && draft.to && draft.from > draft.to) {
      setRangeError('起始日期不能晚于结束日期')
      return
    }
    setRangeError(null)
    setSearchParams(paramsFromDraft(draft, 0))
  }

  const onPageChange = (p: number) => {
    setSearchParams(paramsFromDraft(appliedDraft, Math.max(0, (p - 1) * PAGE_SIZE)))
  }

  const exportCsv = async () => {
    try {
      await exportAuditCsv(applied)
      toast.success('CSV 导出已开始下载')
    } catch (e) {
      toast.error(apiErrorMessage(e, '导出失败'))
    }
  }

  const columns: Column<PKAuditEvent>[] = [
    {
      key: 'created_at', header: '时间', className: 'w-[16%]',
      render: (e) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(e.created_at)}</span>,
    },
    {
      key: 'actor', header: '操作者', className: 'w-[20%]',
      render: (e) => {
        const email = typeof e.actor_snapshot?.email === 'string' ? e.actor_snapshot.email : ''
        return (
          <div className="min-w-0">
            <p className="truncate">{email || e.actor_id || '—'}</p>
            <p className="text-xs text-muted-foreground">{e.actor_type}</p>
          </div>
        )
      },
    },
    {
      key: 'action', header: '动作', className: 'w-[22%]',
      render: (e) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{e.action}</code>,
    },
    {
      key: 'resource', header: '资源', className: 'w-[42%]',
      render: (e) => (
        <div className="min-w-0">
          <p className="truncate">{e.resource_type}</p>
          {e.resource_id && <p className="truncate font-mono text-xs text-muted-foreground">{e.resource_id}</p>}
        </div>
      ),
    },
  ]

  if (!wsId) {
    return (
      <div>
        <PageHeader title="审计日志" description="工作区内的关键操作记录" />
        <PageEmpty label="请先创建并选择一个工作区" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="审计日志" description="工作区内的关键操作记录（保留最近事件，按时间倒序）" />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">动作</span>
          <Input
            className="w-44"
            placeholder="如 workspace.rename"
            value={draft.action}
            onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">操作者 ID</span>
          <Input
            className="w-52"
            placeholder="actor uuid"
            value={draft.actorId}
            onChange={(e) => setDraft((d) => ({ ...d, actorId: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">资源类型</span>
          <Input
            className="w-40"
            placeholder="如 workspace"
            value={draft.resourceType}
            onChange={(e) => setDraft((d) => ({ ...d, resourceType: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">开始日期</span>
          <Input
            className="w-40"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">结束日期</span>
          <Input
            className="w-40"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          />
        </label>
        <Button onClick={apply}>
          <Search /> 查询
        </Button>
        <Button variant="outline" onClick={exportCsv}>
          <Download /> 导出 CSV
        </Button>
      </div>

      {/* P3-40：日期区间错误就地可见（不静默发起恒空查询） */}
      {rangeError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {rangeError}
        </p>
      )}

      {loading ? (
        <PageLoading label="加载审计日志…" />
      ) : error ? (
        <PageError message={apiErrorMessage(error, '审计日志加载失败')} onRetry={() => refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(e) => e.id}
            empty={<PageEmpty label="暂无审计记录" hint="调整过滤条件或触发一些操作后再来" />}
            pagination={{
              page: Math.floor(offset / PAGE_SIZE) + 1,
              pageSize: PAGE_SIZE,
              total,
              onPageChange,
            }}
          />
        </>
      )}
    </div>
  )
}


import { useEffect, useMemo, useState } from 'react'
import { useSearchParamsCompat } from '../../router'
import { Download, Search } from 'lucide-react'
import { PageHeader, PageLoading, PageError, PageEmpty } from '../../components/Page'
import { DataTable, type Column } from '../../components/DataTable'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Field, FieldLabel } from '../../components/ui/field'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
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
  const [searchParams, setSearchParams] = useSearchParamsCompat()
  
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
      render: (e) => <Badge variant="outline" className="font-mono">{e.action}</Badge>,
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
        <PageHeader title="审计日志" />
        <PageEmpty label="请先创建并选择一个工作区" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="审计日志" />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field className="w-44 gap-1">
          <FieldLabel htmlFor="audit-filter-action">动作</FieldLabel>
          <Input
            id="audit-filter-action"
            placeholder="如 workspace.rename"
            value={draft.action}
            onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
          />
        </Field>
        <Field className="w-52 gap-1">
          <FieldLabel htmlFor="audit-filter-actor-id">操作者 ID</FieldLabel>
          <Input
            id="audit-filter-actor-id"
            placeholder="actor uuid"
            value={draft.actorId}
            onChange={(e) => setDraft((d) => ({ ...d, actorId: e.target.value }))}
          />
        </Field>
        <Field className="w-40 gap-1">
          <FieldLabel htmlFor="audit-filter-resource-type">资源类型</FieldLabel>
          <Input
            id="audit-filter-resource-type"
            placeholder="如 workspace"
            value={draft.resourceType}
            onChange={(e) => setDraft((d) => ({ ...d, resourceType: e.target.value }))}
          />
        </Field>
        <Field className="w-40 gap-1">
          <FieldLabel htmlFor="audit-filter-from">开始日期</FieldLabel>
          <Input
            id="audit-filter-from"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
          />
        </Field>
        <Field className="w-40 gap-1">
          <FieldLabel htmlFor="audit-filter-to">结束日期</FieldLabel>
          <Input
            id="audit-filter-to"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          />
        </Field>
        <Button onClick={apply}>
          <Search /> 查询
        </Button>
        <Button variant="outline" onClick={exportCsv}>
          <Download /> 导出 CSV
        </Button>
      </div>

      {/* P3-40：日期区间错误就地可见（不静默发起恒空查询） */}
      {rangeError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{rangeError}</AlertDescription>
        </Alert>
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

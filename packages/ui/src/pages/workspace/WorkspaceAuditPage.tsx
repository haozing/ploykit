
import { useEffect, useMemo, useState } from 'react'
import { useSearchParamsCompat } from '../../router'
import { Download, Search } from 'lucide-react'
import { PageHeader, PageLoading, PageError, PageEmpty } from '../../components/Page'
import { DataTable, type Column } from '../../components/DataTable'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { DatePicker } from '../../components/DatePicker'
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
import { useT } from '../../i18n'

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

/** 草稿里的 Y-M-D 串 → DatePicker 的本地 Date（空串 → null）。 */
function parseYMD(v: string): Date | null {
  if (!v) return null
  const d = new Date(`${v}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** DatePicker 的本地 Date → 草稿的 Y-M-D 串（null → 空串）。 */
function formatYMD(d: Date | null): string {
  if (!d) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
  const t = useT()
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
      setRangeError(t('workspace.workspaceAudit.rangeError'))
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
      toast.success(t('workspace.workspaceAudit.exportStarted'))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('workspace.workspaceAudit.exportFailed')))
    }
  }

  const columns: Column<PKAuditEvent>[] = [
    {
      key: 'created_at', header: t('workspace.workspaceAudit.colTime'), className: 'w-[16%]',
      render: (e) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(e.created_at)}</span>,
    },
    {
      key: 'actor', header: t('workspace.workspaceAudit.colActor'), className: 'w-[20%]',
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
      key: 'action', header: t('workspace.workspaceAudit.colAction'), className: 'w-[22%]',
      render: (e) => <Badge variant="outline" className="font-mono">{e.action}</Badge>,
    },
    {
      key: 'resource', header: t('workspace.workspaceAudit.colResource'), className: 'w-[42%]',
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
        <PageHeader title={t('workspace.workspaceAudit.title')} />
        <PageEmpty label={t('workspace.workspaceAudit.emptyNoWs')} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title={t('workspace.workspaceAudit.title')} />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field className="w-44 gap-1">
          <FieldLabel htmlFor="audit-filter-action">{t('workspace.workspaceAudit.filterAction')}</FieldLabel>
          <Input
            id="audit-filter-action"
            placeholder={t('workspace.workspaceAudit.filterActionPh')}
            value={draft.action}
            onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
          />
        </Field>
        <Field className="w-52 gap-1">
          <FieldLabel htmlFor="audit-filter-actor-id">{t('workspace.workspaceAudit.filterActorId')}</FieldLabel>
          <Input
            id="audit-filter-actor-id"
            placeholder="actor uuid"
            value={draft.actorId}
            onChange={(e) => setDraft((d) => ({ ...d, actorId: e.target.value }))}
          />
        </Field>
        <Field className="w-40 gap-1">
          <FieldLabel htmlFor="audit-filter-resource-type">{t('workspace.workspaceAudit.filterResourceType')}</FieldLabel>
          <Input
            id="audit-filter-resource-type"
            placeholder={t('workspace.workspaceAudit.filterResourcePh')}
            value={draft.resourceType}
            onChange={(e) => setDraft((d) => ({ ...d, resourceType: e.target.value }))}
          />
        </Field>
        <Field className="w-40 gap-1">
          <FieldLabel htmlFor="audit-filter-from">{t('workspace.workspaceAudit.filterFrom')}</FieldLabel>
          <DatePicker
            id="audit-filter-from"
            value={parseYMD(draft.from)}
            onChange={(d) => setDraft((s) => ({ ...s, from: formatYMD(d) }))}
          />
        </Field>
        <Field className="w-40 gap-1">
          <FieldLabel htmlFor="audit-filter-to">{t('workspace.workspaceAudit.filterTo')}</FieldLabel>
          <DatePicker
            id="audit-filter-to"
            value={parseYMD(draft.to)}
            onChange={(d) => setDraft((s) => ({ ...s, to: formatYMD(d) }))}
          />
        </Field>
        <Button onClick={apply}>
          <Search /> {t('workspace.workspaceAudit.search')}
        </Button>
        <Button variant="outline" onClick={exportCsv}>
          <Download /> {t('workspace.workspaceAudit.exportCsv')}
        </Button>
      </div>

      {/* P3-40：日期区间错误就地可见（不静默发起恒空查询） */}
      {rangeError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{rangeError}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <PageLoading label={t('workspace.workspaceAudit.loading')} />
      ) : error ? (
        <PageError message={apiErrorMessage(error, t('workspace.workspaceAudit.loadFailed'))} onRetry={() => refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(e) => e.id}
            empty={<PageEmpty label={t('workspace.workspaceAudit.empty')} hint={t('workspace.workspaceAudit.emptyHint')} />}
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

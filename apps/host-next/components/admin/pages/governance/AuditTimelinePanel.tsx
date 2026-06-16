import { DataTable, Pagination } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import {
  ActorPill,
  AdminPanel,
  FilterBar,
  GroupedTimelineList,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { RuntimeStoreAuditRecord } from '@/lib/module-runtime';
import { adminListHref } from './GovernancePageModel';
import {
  auditActionFamily,
  auditActorType,
  compactJson,
  recordTypeOptions,
  type AuditUsageRecord,
} from './AuditPageModel';

function FilterResultHint({
  lang,
  visible,
  total,
}: {
  lang: SupportedLanguage;
  visible: number;
  total: number;
}) {
  if (visible === total) {
    return null;
  }
  return (
    <p className="muted">
      {adminInlineText(lang, 'current_filter_shows_value_value_records_ffd8ee7a', {
        value1: visible,
        value2: total,
      })}
    </p>
  );
}

export function AuditTimelinePanel({
  lang,
  tableQuery,
  visibleCount,
  totalCount,
  actorStats,
  familyStats,
  actionStats,
  showAudit,
  showUsage,
  pagedAuditLogs,
  auditPage,
  auditTotalPages,
  usageRecords,
}: {
  lang: SupportedLanguage;
  tableQuery: Required<AdminTableQuery>;
  visibleCount: number;
  totalCount: number;
  actorStats: Record<string, number>;
  familyStats: Record<string, number>;
  actionStats: Record<string, number>;
  showAudit: boolean;
  showUsage: boolean;
  pagedAuditLogs: RuntimeStoreAuditRecord[];
  auditPage: number;
  auditTotalPages: number;
  usageRecords: AuditUsageRecord[];
}) {
  return (
    <AdminPanel
      title={adminInlineText(lang, 'Audit timeline')}
      description={adminInlineText(
        lang,
        'Filter security and usage evidence by actor, module, meter, scope, or metadata.'
      )}
      contentClassName="p-0"
    >
      <FilterBar
        lang={lang}
        embedded
        searchValue={tableQuery.q}
        searchPlaceholder="搜索审计类型、Actor、模块或 meter"
        filterName="type"
        filterValue={tableQuery.type}
        filterLabel="记录"
        filterOptions={recordTypeOptions}
        resetHref={localizedPath(lang, '/admin/audit')}
      />
      <div className="px-4 py-3 sm:px-5">
        <FilterResultHint lang={lang} visible={visibleCount} total={totalCount} />
      </div>
      <DataTable
        className="rounded-none border-x-0 shadow-none"
        columns={adminInlineColumns(lang, ['Group', 'Count'])}
        rows={[
          ...Object.entries(actorStats).map(([actor, count]) => [`actor:${actor}`, String(count)]),
          ...Object.entries(familyStats).map(([family, count]) => [
            `family:${family}`,
            String(count),
          ]),
          ...Object.entries(actionStats).map(([action, count]) => [action, String(count)]),
        ]}
      />
      {showAudit ? (
        <div className="px-4 py-4 sm:px-5">
          <GroupedTimelineList
            lang={lang}
            items={pagedAuditLogs.map((record) => {
              const family = auditActionFamily(record);
              const integritySummary = record.integrity
                ? ` · ${record.integrity.category}/${record.integrity.risk}/${record.integrity.recordHash.slice(0, 19)}`
                : '';
              return {
                key: record.id,
                group: record.createdAt.slice(0, 10),
                title: (
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <ActorPill
                      actorId={record.actorId}
                      actorType={auditActorType(record)}
                      tone={
                        family.tone === 'danger'
                          ? 'danger'
                          : family.tone === 'warning'
                            ? 'warning'
                            : 'neutral'
                      }
                    />
                    <StatusBadge
                      lang={lang}
                      value={family.status}
                      label={family.label}
                      tone={family.tone}
                    />
                    <span className="min-w-0 truncate">{record.type}</span>
                  </span>
                ),
                description: `${family.detail} ${compactJson(
                  record.metadata,
                  220
                )}${integritySummary}`,
                meta: `${record.productId}/${record.workspaceId ?? 'global'}/${record.moduleId ?? 'host'} · ${record.createdAt}`,
                status:
                  family.tone === 'danger' || family.tone === 'warning' ? family.status : undefined,
                statusTone:
                  family.tone === 'danger' || family.tone === 'warning' ? family.tone : undefined,
                tone:
                  family.tone === 'danger'
                    ? 'danger'
                    : family.tone === 'warning'
                      ? 'warning'
                      : 'primary',
              };
            })}
            empty={adminInlineText(lang, 'No audit records match this filter.')}
          />
        </div>
      ) : null}
      {showAudit ? (
        <Pagination
          page={auditPage}
          totalPages={auditTotalPages}
          previousHref={
            auditPage > 1
              ? adminListHref(lang, '/admin/audit', tableQuery, auditPage - 1)
              : undefined
          }
          nextHref={
            auditPage < auditTotalPages
              ? adminListHref(lang, '/admin/audit', tableQuery, auditPage + 1)
              : undefined
          }
        />
      ) : null}
      {showUsage ? (
        <DataTable
          className="rounded-none border-x-0 border-b-0 shadow-none"
          columns={adminInlineColumns(lang, ['Meter', 'Module', 'Quantity'])}
          rows={usageRecords.map((record) => [
            record.meter,
            record.moduleId,
            String(record.quantity),
          ])}
        />
      ) : null}
    </AdminPanel>
  );
}

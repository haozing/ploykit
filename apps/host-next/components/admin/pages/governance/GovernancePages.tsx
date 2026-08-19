import Link from 'next/link';
import { Activity, Download, Search, ShieldAlert } from 'lucide-react';
import { adminNav, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { ActionQueue, StatGrid } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminAuditCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { AdminOperationsSnapshot } from '@host/lib/admin/operations-center';
import type { RuntimeStoreAuditRecord } from '@/lib/module-runtime';
import { AuditDetailDrawer } from './AuditDetailDrawer';
import { buildAuditPageModel } from './AuditPageModel';
import { AuditRetentionPanel } from './AuditRetentionPanel';
import { AuditTimelinePanel } from './AuditTimelinePanel';

export { AdminSearchOperationsPage } from './SearchPage';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function AdminAuditOperationsPage({
  lang,
  snapshot,
  auditLogs,
  applyAuditRetentionAction,
  query,
}: {
  lang: SupportedLanguage;
  snapshot: AdminOperationsSnapshot;
  auditLogs?: RuntimeStoreAuditRecord[];
  applyAuditRetentionAction?: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminAuditCopy(lang);
  const model = buildAuditPageModel({ snapshot, auditLogs, query });
  const auditReviewItems = [
    model.failureCount > 0
      ? {
          key: 'audit-failures',
          title: adminInlineText(lang, 'Failed or denied operations'),
          description:
            lang === 'zh'
              ? `${model.failureCount} 条审计记录包含失败、拒绝、阻塞或错误元数据。清理前请复核操作者、范围和影响。`
              : `${model.failureCount} audit records include failed, denied, blocked, or error metadata. Review actor, scope, and impact before cleanup.`,
          actionLabel: adminInlineText(lang, 'Review audit'),
          href: localizedPath(lang, '/admin/audit?status=failed'),
          status: 'failed',
          tone: 'danger' as const,
        }
      : null,
    model.dangerousActions > 0
      ? {
          key: 'dangerous-actions',
          title: adminInlineText(lang, 'Dangerous actions observed'),
          description:
            lang === 'zh'
              ? `${model.dangerousActions} 条记录涉及删除、撤销、归档、丢弃、禁用或保留策略操作。`
              : `${model.dangerousActions} records involve delete, revoke, archive, discard, disable, or retention operations.`,
          actionLabel: adminInlineText(lang, 'Review actions'),
          href: localizedPath(lang, '/admin/audit'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Link
            href={model.exportCsvHref}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {copy.exportCsv}
          </Link>
          <Link
            href={model.exportJsonHref}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {copy.exportJson}
          </Link>
        </div>
        <StatGrid>
          <StatCard
            label={adminInlineText(lang, 'Audit Actions')}
            value={String(model.auditLogs.length)}
            helper={adminInlineText(lang, 'value_visible_6a947562', {
              value1: model.visibleCount,
            })}
            tone="blue"
            icon={Activity}
          />
          <StatCard
            label={adminInlineText(lang, 'Failures')}
            value={String(model.failureCount)}
            helper={adminInlineText(lang, 'Failed, denied, blocked, or error')}
            tone={model.failureCount > 0 ? 'red' : 'neutral'}
            icon={ShieldAlert}
          />
          <StatCard
            label={adminInlineText(lang, 'Dangerous')}
            value={String(model.dangerousActions)}
            helper={adminInlineText(lang, 'Delete, revoke, archive, discard')}
            tone={model.dangerousActions > 0 ? 'amber' : 'neutral'}
            icon={ShieldAlert}
          />
          <StatCard
            label={adminInlineText(lang, 'Usage Records')}
            value={String(model.usageRecords.length)}
            helper={adminInlineText(lang, 'Operational usage traces')}
            icon={Search}
          />
        </StatGrid>
        {auditReviewItems.length > 0 ? (
          <ActionQueue
            lang={lang}
            title={adminInlineText(lang, 'Security review')}
            description={adminInlineText(
              lang,
              'High-signal audit records are promoted before the full event timeline.'
            )}
            status="warning"
            items={auditReviewItems}
          />
        ) : null}
        {model.focusAudit ? (
          <AuditDetailDrawer lang={lang} focusAudit={model.focusAudit} />
        ) : null}
        {applyAuditRetentionAction ? (
          <AuditRetentionPanel
            lang={lang}
            applyAuditRetentionAction={applyAuditRetentionAction}
          />
        ) : null}
        <AuditTimelinePanel
          lang={lang}
          tableQuery={model.tableQuery}
          visibleCount={model.visibleCount}
          totalCount={model.totalCount}
          actorStats={model.actorStats}
          familyStats={model.familyStats}
          actionStats={model.actionStats}
          showAudit={model.showAudit}
          showUsage={model.showUsage}
          pagedAuditLogs={model.pagedAuditLogs}
          auditPage={model.auditPage}
          auditTotalPages={model.auditTotalPages}
          usageRecords={model.usageRecords}
        />
      </div>
    </WorkspaceShell>
  );
}

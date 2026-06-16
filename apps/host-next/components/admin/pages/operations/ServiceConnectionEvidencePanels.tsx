import { DataTable } from '@host/components/ui';
import { AdminPanel, HealthRowList, TimelineList } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { AdminServiceConnectionsView } from '@host/lib/admin-service-connections';
import { compactJson } from './OperationsPageUtils';

export function AdminServiceConnectionEvidencePanels({
  lang,
  connections,
}: {
  lang: SupportedLanguage;
  connections: AdminServiceConnectionsView;
}) {
  return (
    <>
      <AdminPanel
        title={adminInlineText(lang, 'Provider readiness')}
        description={adminInlineText(
          lang,
          'Config doctor provider checks are presented as operational health rows.'
        )}
      >
        <HealthRowList
          lang={lang}
          items={connections.configDoctor.providerReadiness.map((provider) => ({
            key: provider.id,
            title: provider.id,
            detail: provider.detail,
            meta: provider.mode,
            status: provider.status,
            tone:
              provider.status === 'ready'
                ? 'success'
                : provider.status === 'blocked'
                  ? 'danger'
                  : 'warning',
          }))}
          empty={adminInlineText(lang, 'No provider readiness checks.')}
        />
      </AdminPanel>

      <AdminPanel
        title={adminInlineText(lang, 'Connection call timeline')}
        description={adminInlineText(
          lang,
          'Recent connection operations grouped by actor and metadata.'
        )}
      >
        <TimelineList
          lang={lang}
          items={connections.callLogs.map((record) => ({
            key: record.id,
            title: record.type.replace('admin.connection.', ''),
            description: compactJson(record.metadata, 220),
            meta: record.actorId ?? 'system',
            tone: record.type.includes('failed')
              ? 'danger'
              : record.type.includes('rotate')
                ? 'warning'
                : 'primary',
          }))}
          empty={adminInlineText(lang, 'No connection operation logs yet.')}
        />
      </AdminPanel>

      {connections.configDoctor.diagnostics.length > 0 ? (
        <AdminPanel
          title={adminInlineText(lang, 'Config diagnostics')}
          description={adminInlineText(lang, 'Only unresolved diagnostics are shown here.')}
          contentClassName="p-0"
        >
          <DataTable
            className="rounded-none border-x-0 shadow-none"
            columns={adminInlineColumns(lang, ['Severity', 'Code', 'Fix'])}
            rows={connections.configDoctor.diagnostics.map((item) => [
              item.severity,
              item.code,
              item.fix ?? item.message,
            ])}
          />
        </AdminPanel>
      ) : null}
    </>
  );
}

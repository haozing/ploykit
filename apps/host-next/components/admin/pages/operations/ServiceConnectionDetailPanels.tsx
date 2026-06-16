import Link from 'next/link';
import { DetailDrawer } from '@host/components/ui';
import {
  AdminPanel,
  FactList,
  HealthRowList,
} from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { AdminServiceConnectionsView } from '@host/lib/admin-service-connections';
import { adminRelatedHref, connectionCorrelationKey } from './OperationsPageUtils';

type AdminServiceConnectionRow = AdminServiceConnectionsView['connections'][number];

export function AdminServiceConnectionDetailPanels({
  lang,
  connection,
}: {
  lang: SupportedLanguage;
  connection: AdminServiceConnectionRow | null;
}) {
  if (!connection) {
    return null;
  }

  const correlationKey = connectionCorrelationKey(connection);

  return (
    <>
      <DetailDrawer
        open
        title={adminInlineText(lang, 'Connection detail')}
        description={`${connection.service} · ${connection.provider}`}
        className="mb-5"
        actions={[
          <Link
            key="runs"
            href={adminRelatedHref(lang, '/admin/runs', { q: correlationKey })}
            className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
          >
            {adminInlineText(lang, 'Runs')}
          </Link>,
          <Link
            key="jobs"
            href={adminRelatedHref(lang, '/admin/runs', { q: correlationKey, type: 'job' })}
            className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
          >
            {adminInlineText(lang, 'Jobs')}
          </Link>,
          <Link
            key="audit"
            href={adminRelatedHref(lang, '/admin/audit', { q: connection.id })}
            className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
          >
            {adminInlineText(lang, 'Audit')}
          </Link>,
          <Link
            key="settings"
            href={localizedPath(lang, '/admin/settings')}
            className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
          >
            {adminInlineText(lang, 'Settings')}
          </Link>,
          <Link
            key="webhooks"
            href={adminRelatedHref(lang, '/admin/webhooks', { q: correlationKey })}
            className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
          >
            {adminInlineText(lang, 'Webhooks')}
          </Link>,
        ]}
      >
        <FactList
          lang={lang}
          density="compact"
          items={[
            {
              label: 'Connection ID',
              value: connection.id,
              copyValue: connection.id,
              mono: true,
            },
            { label: 'Service', value: connection.service },
            { label: 'Provider', value: connection.provider },
            { label: 'Environment', value: connection.environment },
            {
              label: 'Scope',
              value: `${connection.ownerType}/${connection.scopeType}`,
            },
            { label: 'Workspace', value: connection.workspaceId ?? 'global' },
            { label: 'Status', value: connection.status },
            { label: 'Impact', value: connection.required ? 'required' : 'optional' },
            { label: 'Last check', value: connection.lastTestAt ?? 'not checked' },
            { label: 'Policy updated', value: connection.policyUpdatedAt ?? 'not updated' },
            { label: 'Last error', value: connection.lastError ?? 'none' },
            { label: 'Detail', value: connection.detail },
          ]}
        />
      </DetailDrawer>
      <AdminPanel
        title={adminInlineText(lang, 'Related operations')}
        description={adminInlineText(
          lang,
          'related_links_use_the_connection_id_module_id_or_ser_72aa3ac2'
        )}
      >
        <HealthRowList
          lang={lang}
          items={[
            {
              key: 'connection-related-runs',
              title: 'Runs',
              detail: adminInlineText(
                lang,
                'inspect_runs_that_share_the_module_or_service_correl_28b78544'
              ),
              meta: correlationKey,
              status: 'linked',
              statusTone: 'info',
              tone: 'info',
              href: adminRelatedHref(lang, '/admin/runs', { q: correlationKey }),
            },
            {
              key: 'connection-related-jobs',
              title: 'Jobs',
              detail: adminInlineText(
                lang,
                'jobs_do_not_have_a_standalone_admin_route_yet_the_li_efdc32a1'
              ),
              meta: 'type=job',
              status: 'run-kind',
              statusTone: 'info',
              tone: 'primary',
              href: adminRelatedHref(lang, '/admin/runs', {
                q: correlationKey,
                type: 'job',
              }),
            },
            {
              key: 'connection-related-webhooks',
              title: 'Webhooks',
              detail: adminInlineText(
                lang,
                'inspect_outbox_receipt_and_dead_letter_records_for_t_228f29e7'
              ),
              meta: connection.moduleId ?? connection.service,
              status: 'linked',
              statusTone: 'info',
              tone: 'primary',
              href: adminRelatedHref(lang, '/admin/webhooks', { q: correlationKey }),
            },
            {
              key: 'connection-related-audit',
              title: 'Audit',
              detail: adminInlineText(
                lang,
                'search_policy_test_rotation_and_retention_audit_by_c_974bef4c'
              ),
              meta: connection.id,
              status: 'linked',
              statusTone: 'info',
              tone: 'neutral',
              href: adminRelatedHref(lang, '/admin/audit', { q: connection.id }),
            },
          ]}
        />
      </AdminPanel>
    </>
  );
}

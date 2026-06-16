import {
  Activity,
  Box,
  CircleCheck,
  Clock3,
  PackageCheck,
  RotateCcw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import {
  adminNav,
  StatCard,
  WorkspaceShell,
} from '@host/components/ProductShell';
import { ActionQueue, StatGrid } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminServiceConnectionsCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { AdminServiceConnectionsView } from '@host/lib/admin-service-connections';
import {
  cleanTableQuery,
  matchesExactFilter,
  matchesTextSearch,
  uniqueSelectOptions,
} from './OperationsPageUtils';
import { AdminServiceConnectionDetailPanels } from './ServiceConnectionDetailPanels';
import { AdminServiceConnectionEvidencePanels } from './ServiceConnectionEvidencePanels';
import { AdminServiceConnectionMaintenancePanel } from './ServiceConnectionMaintenancePanel';
import { AdminServiceConnectionTableSection } from './ServiceConnectionTableSection';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function AdminServiceConnectionsOperationsPage({
  lang,
  connections,
  testConnectionAction,
  updateConnectionStatusAction,
  createConnectionAction,
  updateConnectionPolicyAction,
  applyLogRetentionAction,
  rotateConnectionSecretAction,
  query,
}: {
  lang: SupportedLanguage;
  connections: AdminServiceConnectionsView;
  testConnectionAction?: AdminFormAction;
  updateConnectionStatusAction?: AdminFormAction;
  createConnectionAction?: AdminFormAction;
  updateConnectionPolicyAction?: AdminFormAction;
  applyLogRetentionAction?: AdminFormAction;
  rotateConnectionSecretAction?: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminServiceConnectionsCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const moduleOptions = uniqueSelectOptions(
    connections.connections.map((connection) => connection.moduleId ?? 'host')
  );
  const serviceOptions = uniqueSelectOptions(
    connections.connections.map((connection) => connection.service)
  );
  const workspaceOptions = uniqueSelectOptions(
    connections.connections.map((connection) => connection.workspaceId ?? 'global')
  );
  const environmentOptions = uniqueSelectOptions(
    connections.connections.map((connection) => connection.environment)
  );
  const filteredConnections = connections.connections.filter(
    (connection) =>
      matchesTextSearch(tableQuery.q, [
        connection.id,
        connection.moduleId ?? 'host',
        connection.service,
        connection.provider,
        connection.environment,
        connection.workspaceId ?? '',
        connection.status,
        connection.detail,
      ]) &&
      matchesExactFilter(tableQuery.moduleId, connection.moduleId ?? 'host') &&
      matchesExactFilter(tableQuery.service, connection.service) &&
      matchesExactFilter(tableQuery.status, connection.status) &&
      matchesExactFilter(tableQuery.workspace, connection.workspaceId ?? 'global') &&
      matchesExactFilter(tableQuery.environment, connection.environment)
  );
  const connectionReviewItems = [
    connections.summary.blocked > 0
      ? {
          key: 'blocked-connections',
          title: 'Blocked service connections',
          description: `${connections.summary.blocked} connections cannot be used. Check provider readiness, secret source, and required configuration before production traffic.`,
          actionLabel: 'Filter blocked',
          href: localizedPath(lang, '/admin/service-connections?status=blocked'),
          status: 'blocked',
          tone: 'danger' as const,
        }
      : null,
    connections.summary.warning > 0
      ? {
          key: 'warning-connections',
          title: 'Connections need review',
          description: `${connections.summary.warning} connections are degraded or missing optional readiness evidence.`,
          actionLabel: 'Filter warning',
          href: localizedPath(lang, '/admin/service-connections?status=warning'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    !connections.configDoctor.ok
      ? {
          key: 'config-doctor',
          title: 'Configuration doctor is blocked',
          description: `${connections.configDoctor.diagnostics.length} diagnostics need attention before service readiness can be trusted.`,
          actionLabel: 'Review diagnostics',
          href: localizedPath(lang, '/admin/settings'),
          status: 'blocked',
          tone: 'danger' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const focusConnection =
    filteredConnections.find((connection) => connection.status === 'blocked') ??
    filteredConnections.find((connection) => connection.status === 'warning') ??
    filteredConnections[0] ??
    connections.connections[0] ??
    null;
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Ready')}
          value={String(connections.summary.ready)}
          helper={adminInlineText(lang, 'Healthy providers')}
          tone="green"
          icon={CircleCheck}
        />
        <StatCard
          label={adminInlineText(lang, 'Warning')}
          value={String(connections.summary.warning)}
          helper={adminInlineText(lang, 'Needs readiness review')}
          tone={connections.summary.warning > 0 ? 'amber' : 'neutral'}
          icon={TriangleAlert}
        />
        <StatCard
          label={adminInlineText(lang, 'Blocked')}
          value={String(connections.summary.blocked)}
          helper={adminInlineText(lang, 'Cannot serve traffic')}
          tone={connections.summary.blocked > 0 ? 'red' : 'neutral'}
          icon={ShieldAlert}
        />
        <StatCard
          label={adminInlineText(lang, 'Disabled')}
          value={String(connections.summary.disabled)}
          helper={adminInlineText(lang, 'Intentionally inactive')}
          tone={connections.summary.disabled > 0 ? 'amber' : 'neutral'}
          icon={Clock3}
        />
      </StatGrid>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Config Doctor')}
          value={connections.configDoctor.ok ? 'ready' : 'blocked'}
          helper={adminInlineText(lang, 'Host configuration evidence')}
          tone={connections.configDoctor.ok ? 'green' : 'red'}
          icon={Activity}
        />
        <StatCard
          label={adminInlineText(lang, 'Route Catalog')}
          value={`${connections.configDoctor.metrics.routeCatalogEntries}/${connections.configDoctor.metrics.apiRoutesDiscovered}`}
          helper={adminInlineText(lang, 'Declared / discovered')}
          icon={Box}
        />
        <StatCard
          label={adminInlineText(lang, 'Providers')}
          value={`${connections.configDoctor.metrics.providersReady}/${connections.configDoctor.metrics.providersTotal}`}
          helper={adminInlineText(lang, 'Ready / total')}
          tone={
            connections.configDoctor.metrics.providersReady ===
            connections.configDoctor.metrics.providersTotal
              ? 'green'
              : 'amber'
          }
          icon={PackageCheck}
        />
        <StatCard
          label={adminInlineText(lang, 'Call Logs')}
          value={String(connections.callLogs.length)}
          helper={adminInlineText(lang, 'Recent operations')}
          icon={RotateCcw}
        />
      </StatGrid>
      {connectionReviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'Service readiness')}
          description={adminInlineText(
            lang,
            'Connections that affect production readiness are promoted before the provider matrix.'
          )}
          status="warning"
          items={connectionReviewItems}
        />
      ) : null}
      <AdminServiceConnectionDetailPanels lang={lang} connection={focusConnection} />
      <AdminServiceConnectionMaintenancePanel
        lang={lang}
        connections={connections}
        createConnectionAction={createConnectionAction}
        updateConnectionPolicyAction={updateConnectionPolicyAction}
        applyLogRetentionAction={applyLogRetentionAction}
        rotateConnectionSecretAction={rotateConnectionSecretAction}
      />
      <AdminServiceConnectionTableSection
        lang={lang}
        connections={connections}
        tableQuery={tableQuery}
        filteredConnections={filteredConnections}
        moduleOptions={moduleOptions}
        serviceOptions={serviceOptions}
        workspaceOptions={workspaceOptions}
        environmentOptions={environmentOptions}
        testConnectionAction={testConnectionAction}
        updateConnectionStatusAction={updateConnectionStatusAction}
        rotateConnectionSecretAction={rotateConnectionSecretAction}
      />
      <AdminServiceConnectionEvidencePanels lang={lang} connections={connections} />
    </WorkspaceShell>
  );
}

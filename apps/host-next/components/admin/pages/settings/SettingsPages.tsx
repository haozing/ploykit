import type { ReactNode } from 'react';
import { CreditCard, Database, HardDrive, Settings2 } from 'lucide-react';
import { adminNav, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { DataTable } from '@host/components/ui';
import { ActionQueue, AdminPanel, StatGrid } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminSettingsCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { AdminOperationsSnapshot, RuntimeStoreAuditRecord } from '@/lib/module-runtime';
import type { AdminProviderStatusView } from '@host/lib/admin-provider-status';
import type { AdminWorkerStatusView } from '@host/lib/admin-worker-status';
import type { HostConfigDoctorReport } from '@host/lib/config-doctor';
import type { HostRuntimeHealth } from '@host/lib/host-health';
import type { HostRuntimeStoreStatus } from '@host/lib/runtime-store';
import type { AdminHostSettingsView } from '@host/lib/admin-settings';
import {
  SettingsDiagnosticsCenter,
  SettingsDiagnosticsSummary,
} from './SettingsDiagnosticsPanels';
import {
  SettingsProductSettingsPanel,
  SettingsSaveButton,
  type AdminFormAction,
} from './SettingsProductSettingsPanel';
import { SettingsResolvedPanel } from './SettingsResolvedPanel';
import { SettingsRuntimeConfigPanel } from './SettingsRuntimeConfigPanel';
import { SettingsThemePreviewPanel } from './SettingsThemePreviewPanel';

export function AdminSettingsOperationsPage({
  lang,
  store,
  health,
  configDoctor,
  providerStatus,
  workerStatus,
  settings,
  updateSettingsAction,
  compositionPanel,
}: {
  lang: SupportedLanguage;
  snapshot: AdminOperationsSnapshot;
  store: HostRuntimeStoreStatus;
  health?: HostRuntimeHealth;
  configDoctor?: HostConfigDoctorReport;
  providerStatus?: AdminProviderStatusView;
  workerStatus?: AdminWorkerStatusView;
  settings?: AdminHostSettingsView;
  updateSettingsAction?: AdminFormAction;
  compositionPanel?: ReactNode;
  query?: AdminTableQuery;
  auditLogs?: RuntimeStoreAuditRecord[];
}) {
  const copy = getAdminSettingsCopy(lang);
  const fileStorage = health?.files;
  const billingProvider = health?.billing;
  const settingsReviewItems = [
    !store.durable
      ? {
          key: 'runtime-store',
          title: adminInlineText(lang, 'Runtime store is not durable'),
          description: adminInlineText(
            lang,
            'The host is running in local memory mode. Move runtime state to Postgres before production traffic.'
          ),
          actionLabel: adminInlineText(lang, 'Review database'),
          href: localizedPath(lang, '/admin/settings'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    fileStorage && !fileStorage.durable
      ? {
          key: 'file-storage',
          title: adminInlineText(lang, 'File storage is not durable'),
          description: adminInlineText(
            lang,
            'file_storage_is_using_value_configure_durable_object_7f7b6e93',
            { value1: fileStorage.mode }
          ),
          actionLabel: adminInlineText(lang, 'Review files'),
          href: localizedPath(lang, '/admin/files'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    configDoctor && !configDoctor.ok
      ? {
          key: 'config-doctor',
          title: adminInlineText(lang, 'Configuration doctor needs attention'),
          description: adminInlineText(
            lang,
            'value_diagnostics_are_open_across_route_catalog_prov_bc8bb0a0',
            { value1: configDoctor.diagnostics.length }
          ),
          actionLabel: adminInlineText(lang, 'Review diagnostics'),
          href: localizedPath(lang, '/admin/settings'),
          status: 'blocked',
          tone: 'danger' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <WorkspaceShell
      lang={lang}
      title={copy.title}
      subtitle={copy.subtitle}
      nav={adminNav}
      actions={
        settings && updateSettingsAction ? (
          <SettingsSaveButton lang={lang} formId="settings-product-form" />
        ) : null
      }
    >
      <div className="grid min-w-0 gap-5 [&>*]:min-w-0">
        <StatGrid className="order-1">
          <StatCard
            label={adminInlineText(lang, 'Runtime Store')}
            value={store.mode}
            helper={store.durable ? store.databaseLabel : 'local memory mode'}
            tone={store.durable ? 'green' : 'red'}
            icon={Database}
          />
          <StatCard
            label={adminInlineText(lang, 'File Storage')}
            value={fileStorage?.mode ?? 'local'}
            helper={fileStorage?.durable ? 'durable' : 'development mode'}
            tone={fileStorage?.durable ? 'green' : 'amber'}
            icon={HardDrive}
          />
          <StatCard
            label={adminInlineText(lang, 'Billing')}
            value={billingProvider?.mode ?? 'local'}
            helper={billingProvider?.stripeConfigured ? 'Stripe configured' : 'local ledger'}
            tone={billingProvider?.stripeConfigured ? 'green' : 'amber'}
            icon={CreditCard}
          />
          <StatCard
            label={adminInlineText(lang, 'Config Doctor')}
            value={configDoctor?.ok ? 'ready' : 'needs attention'}
            helper={configDoctor ? `${configDoctor.diagnostics.length} diagnostics` : 'not loaded'}
            tone={configDoctor?.ok ? 'green' : 'red'}
            icon={Settings2}
          />
        </StatGrid>
        {settingsReviewItems.length > 0 ? (
          <ActionQueue
            lang={lang}
            className="order-6"
            title={adminInlineText(lang, 'Settings review')}
            description={adminInlineText(
              lang,
              'Production-readiness issues stay visible in the operational diagnostics section.'
            )}
            status="warning"
            items={settingsReviewItems}
          />
        ) : null}
        <SettingsRuntimeConfigPanel
          lang={lang}
          store={store}
          health={health}
          configDoctor={configDoctor}
        />
        {settings && updateSettingsAction ? (
          <SettingsProductSettingsPanel
            lang={lang}
            settings={settings}
            updateSettingsAction={updateSettingsAction}
          />
        ) : null}
        {settings ? <SettingsResolvedPanel lang={lang} settings={settings} /> : null}
        <SettingsThemePreviewPanel lang={lang} settings={settings} />
        <div className="order-5">{compositionPanel}</div>
        <SettingsDiagnosticsCenter
          lang={lang}
          providerStatus={providerStatus}
          workerStatus={workerStatus}
        />
        <SettingsDiagnosticsSummary lang={lang} store={store} health={health} configDoctor={configDoctor} />
      </div>
    </WorkspaceShell>
  );
}

export function AdminSectionPage({
  lang,
  title,
  subtitle,
  rows,
}: {
  lang: SupportedLanguage;
  title: string;
  subtitle: string;
  rows: readonly (readonly string[])[];
}) {
  return (
    <WorkspaceShell lang={lang} title={title} subtitle={subtitle} nav={adminNav}>
      <AdminPanel title={title} description={subtitle} contentClassName="p-0">
        <DataTable
          className="rounded-none border-x-0 border-b-0 shadow-none"
          columns={adminInlineColumns(lang, ['Object', 'State', 'Note'])}
          rows={rows}
        />
      </AdminPanel>
    </WorkspaceShell>
  );
}

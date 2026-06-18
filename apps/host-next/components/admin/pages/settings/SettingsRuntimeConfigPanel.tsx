import { AdminPanel, HealthRowList } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { HostConfigDoctorReport } from '@host/lib/config-doctor';
import type { HostRuntimeHealth } from '@host/lib/host-health';
import type { HostRuntimeStoreStatus } from '@host/lib/runtime-store';

export function SettingsRuntimeConfigPanel({
  lang,
  store,
  health,
  configDoctor,
}: {
  lang: SupportedLanguage;
  store: HostRuntimeStoreStatus;
  health?: HostRuntimeHealth;
  configDoctor?: HostConfigDoctorReport;
}) {
  const fileStorage = health?.files;
  const billingProvider = health?.billing;

  return (
    <AdminPanel
      className="order-7"
      title={adminInlineText(lang, 'Runtime config')}
      description={adminInlineText(
        lang,
        'Infrastructure readiness is separated from product settings so operators can scan durability, providers, auth, and security boundaries.'
      )}
    >
      <HealthRowList
        lang={lang}
        items={[
          {
            key: 'database',
            title: 'Database',
            detail: store.durable
              ? store.databaseLabel
              : 'Runtime state is still using local memory mode.',
            meta: store.mode,
            status: store.durable ? 'durable' : 'memory',
            statusTone: store.durable ? 'success' : 'danger',
            tone: store.durable ? 'success' : 'danger',
          },
          {
            key: 'files',
            title: 'File storage',
            detail:
              fileStorage?.mode === 's3'
                ? `${fileStorage.bucket ?? 'bucket'} @ ${fileStorage.region ?? 'region'}`
                : (fileStorage?.rootDir ?? 'local or memory storage'),
            meta: fileStorage?.mode ?? 'local',
            status: fileStorage?.durable ? 'durable' : 'development',
            statusTone: fileStorage?.durable ? 'success' : 'warning',
            tone: fileStorage?.durable ? 'success' : 'warning',
            href: localizedPath(lang, '/admin/files'),
          },
          {
            key: 'billing',
            title: 'Billing provider',
            detail: billingProvider?.stripeWebhookConfigured
              ? 'Stripe webhook is configured.'
              : 'Using local ledger or missing webhook secret.',
            meta: billingProvider?.mode ?? 'local',
            status: billingProvider?.stripeConfigured ? 'configured' : 'local',
            statusTone: billingProvider?.stripeConfigured ? 'success' : 'warning',
            tone: billingProvider?.stripeConfigured ? 'success' : 'warning',
            href: localizedPath(lang, '/admin/revenue'),
          },
          {
            key: 'auth',
            title: 'Authentication',
            detail: health?.auth.secretConfigured
              ? 'Auth signing key ring configured.'
              : 'Volatile development signing key.',
            meta: health?.auth.mode ?? 'runtime-store-signed-cookie',
            status: health?.auth.secretConfigured ? 'configured' : 'development',
            statusTone: health?.auth.secretConfigured ? 'success' : 'warning',
            tone: health?.auth.secretConfigured ? 'success' : 'warning',
          },
          {
            key: 'security',
            title: 'Security runtime',
            detail: configDoctor
              ? lang === 'zh'
                ? `${configDoctor.metrics.routeCatalogEntries} 条路由目录记录，发现 ${configDoctor.metrics.apiRoutesDiscovered} 条 API 路由。`
                : `${configDoctor.metrics.routeCatalogEntries} route catalog entries and ${configDoctor.metrics.apiRoutesDiscovered} discovered API routes.`
              : `csrf=${health?.security.csrf ?? 'runtime-only'}, rate=${health?.security.rateLimit ?? 'runtime-only'}`,
            meta: configDoctor?.ok ? 'ready' : 'review',
            status: configDoctor?.ok ? 'ready' : 'review',
            statusTone: configDoctor?.ok ? 'success' : 'warning',
            tone: configDoctor?.ok ? 'success' : 'warning',
          },
        ]}
      />
    </AdminPanel>
  );
}

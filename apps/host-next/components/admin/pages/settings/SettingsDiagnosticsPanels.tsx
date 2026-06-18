import { DataTable } from '@host/components/ui';
import { ProviderStatusPanel } from '@host/components/admin/shared/ProviderStatusPanel';
import { WorkerStatusPanel } from '@host/components/admin/shared/WorkerStatusPanel';
import { SegmentedWorkspace } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminProviderStatusView } from '@host/lib/admin-provider-status';
import type { AdminWorkerStatusView } from '@host/lib/admin-worker-status';
import type { HostConfigDoctorReport } from '@host/lib/config-doctor';
import type { HostRuntimeHealth } from '@host/lib/host-health';
import type { HostRuntimeStoreStatus } from '@host/lib/runtime-store';

export function SettingsDiagnosticsCenter({
  lang,
  providerStatus,
  workerStatus,
}: {
  lang: SupportedLanguage;
  providerStatus?: AdminProviderStatusView;
  workerStatus?: AdminWorkerStatusView;
}) {
  return (
    <SegmentedWorkspace
      lang={lang}
      className="order-8"
      title={adminInlineText(lang, 'Diagnostics center')}
      description={adminInlineText(
        lang,
        'Provider and worker evidence are separated into independent operational lanes so readiness reviews do not mix concerns.'
      )}
      sections={[
        {
          key: 'provider-diagnostics',
          label: 'Provider',
          content: (
            <ProviderStatusPanel
              lang={lang}
              status={providerStatus}
              title={adminInlineText(lang, 'Diagnostics · Provider Matrix')}
              description={adminInlineText(
                lang,
                '配置诊断就绪度、供应商矩阵最新结果和本地供应商深度冒烟测试。'
              )}
            />
          ),
        },
        {
          key: 'worker-diagnostics',
          label: 'Worker',
          content: (
            <WorkerStatusPanel
              lang={lang}
              status={workerStatus}
              title={adminInlineText(lang, 'Diagnostics · Worker Matrix')}
              description={adminInlineText(
                lang,
                'Worker 心跳、队列延迟、死信和最新 Worker 浸泡测试证据。'
              )}
            />
          ),
        },
      ]}
    />
  );
}

export function SettingsDiagnosticsSummary({
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
    <div className="order-9">
      <DataTable
        title={adminInlineText(lang, 'Diagnostics summary')}
        description={adminInlineText(
          lang,
          'Provider, security, retention, and runtime readiness in one compact evidence table.'
        )}
        columns={adminInlineColumns(lang, ['Config', 'State', 'Detail'])}
        rows={[
          ['Database', store.durable ? 'durable' : 'memory', store.databaseLabel],
          [
            'Files',
            fileStorage?.durable ? 'durable' : 'memory',
            fileStorage?.mode === 's3'
              ? `${fileStorage.bucket ?? 'bucket'} @ ${fileStorage.region ?? 'region'}`
              : (fileStorage?.rootDir ?? 'memory'),
          ],
          [
            'Stripe',
            billingProvider?.stripeConfigured ? 'configured' : 'local fallback',
            billingProvider?.stripeWebhookConfigured ? 'webhook ready' : 'webhook secret missing',
          ],
          [
            'Auth',
            health?.auth.mode ?? 'runtime-store-signed-cookie',
            health?.auth.secretConfigured
              ? 'auth signing key ring configured'
              : 'volatile dev signing key',
          ],
          [
            'Product Scope',
            health?.productScope.mode ?? 'in-memory-default-scope',
            health?.productScope.durable ? 'durable' : 'memory fallback',
          ],
          [
            'AI/RAG/Notifications',
            `${health?.providers.ai.mode ?? 'static'} / ${health?.providers.rag.mode ?? 'memory-vector'} / ${health?.providers.notifications ?? 'runtime-store'}`,
            'provider readiness summary',
          ],
          [
            'Worker',
            health?.worker.mode ?? 'runtime-store-loop',
            `durableQueue=${String(health?.worker.durableQueue ?? store.durable)}, lease=${health?.worker.lease ?? 'none'}`,
          ],
          [
            'Security',
            `csrf=${health?.security.csrf ?? 'runtime-only'}, rate=${health?.security.rateLimit ?? 'runtime-only'}`,
            configDoctor
              ? `routeCatalog=${configDoctor.metrics.routeCatalogEntries}, apiRoutes=${configDoctor.metrics.apiRoutesDiscovered}`
              : `routeCatalog=${health?.security.routeCatalog ?? 'missing'}`,
          ],
          [
            'Config Doctor',
            configDoctor?.ok ? 'ready' : 'blocked or warnings',
            configDoctor
              ? `${configDoctor.diagnostics.length} diagnostics, ${configDoctor.metrics.providersReady}/${configDoctor.metrics.providersTotal} providers ready`
              : 'not loaded',
          ],
          [
            'Retention',
            'policy snapshot',
            configDoctor
              ? `${configDoctor.retention.files}; audit=${configDoctor.retention.auditLogs}`
              : 'not loaded',
          ],
        ]}
      />
    </div>
  );
}

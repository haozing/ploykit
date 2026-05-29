import { StatCard } from '@host/components/ProductShell';
import { DataTable } from '@host/components/ui';
import type { AdminProviderStatusView } from '@host/lib/admin-provider-status';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import { StatusBadge } from './StatusBadge';
import { AdminPanel, HealthRowList, StatGrid } from './AdminPrimitives';

function matrixState(status: AdminProviderStatusView): string {
  if (!status.matrix.exists) {
    return 'missing';
  }
  return status.matrix.ok ? 'passed' : 'failed';
}

function matrixDetail(status: AdminProviderStatusView): string {
  if (!status.matrix.exists) {
    return 'Run host:provider-matrix';
  }
  const parts = [
    status.matrix.required ? 'required' : 'local',
    `${status.matrix.checks.length} checks`,
    status.matrix.localDepth.present ? 'local-depth' : 'local-depth missing',
  ];
  if (status.matrix.failedChecks.length > 0) {
    parts.push(`failed ${status.matrix.failedChecks.length}`);
  }
  if (status.matrix.skippedChecks.length > 0) {
    parts.push(`skipped ${status.matrix.skippedChecks.length}`);
  }
  return parts.join(' · ');
}

export function ProviderStatusPanel({
  status,
  title = 'Provider Status',
  description = 'Provider readiness uses the same readiness model as Config Doctor and the provider matrix.',
  compact = false,
  lang = 'zh',
}: {
  status?: AdminProviderStatusView;
  title?: string;
  description?: string;
  compact?: boolean;
  lang?: SupportedLanguage;
}) {
  if (!status) {
    return null;
  }
  const t = (text: string) => adminInlineText(lang, text);
  const tc = (columns: readonly string[]) => adminInlineColumns(lang, columns);

  const providerRows = status.providers.map((provider) => [
    t(provider.label),
    <StatusBadge key={`${provider.id}:status`} lang={lang} value={provider.status} />,
    t(provider.mode),
    t(provider.detail),
    <StatusBadge key={`${provider.id}:evidence`} lang={lang} value={provider.evidenceStatus} />,
    provider.failureDetails.length > 0
      ? `${provider.failureDetails.filter((detail) => detail.severity === 'error').length} errors / ${provider.failureDetails.filter((detail) => detail.severity === 'warning').length} warnings`
      : 'clear',
    t(provider.action),
  ]);
  const failureRows = status.providers.flatMap((provider) =>
    provider.failureDetails.map((detail) => [
      t(provider.label),
      detail.checkId,
      <StatusBadge key={`${provider.id}:${detail.checkId}:status`} lang={lang} value={detail.status} />,
      detail.missing.length > 0 ? detail.missing.join(', ') : '-',
      t(detail.reason),
      t(detail.action),
    ])
  );
  const operationRows = status.providers.flatMap((provider) =>
    provider.operations.map((operation) => [
      t(provider.label),
      t(operation.label),
      t(operation.kind),
      operation.command ?? operation.href ?? '-',
      t(operation.detail),
    ])
  );
  const matrixRows = status.matrix.exists
    ? status.matrix.checks.slice(0, compact ? 6 : 12).map((check) => [
        check.id,
        <StatusBadge key={`${check.id}:status`} lang={lang} value={check.status} />,
        check.command ?? '-',
        check.error ?? check.detail,
      ])
    : [[t('Provider matrix'), <StatusBadge key="matrix-missing" lang={lang} value="missing" />, '-', 'Run npm run host:provider-matrix']];

  return (
    <AdminPanel title={t(title)} description={t(description)} contentClassName="grid gap-4">
      <StatGrid>
        <StatCard
          label={t('Providers')}
          value={`${status.providersReady}/${status.providersTotal}`}
          tone={status.providersBlocked > 0 ? 'red' : status.providersWarning > 0 ? 'amber' : 'blue'}
        />
        <StatCard
          label={t('Warnings')}
          value={String(status.providersWarning)}
          tone={status.providersWarning > 0 ? 'amber' : 'blue'}
        />
        <StatCard
          label={t('Matrix')}
          value={matrixState(status)}
          tone={status.matrix.exists && status.matrix.ok ? 'blue' : 'red'}
        />
        <StatCard
          label={t('Local Depth')}
          value={status.matrix.localDepth.ok ? 'passed' : 'missing'}
          tone={status.matrix.localDepth.ok ? 'blue' : 'red'}
        />
      </StatGrid>
      <HealthRowList
        lang={lang}
        items={status.providers.map((provider) => ({
          key: provider.id,
          title: provider.label,
          detail: provider.detail,
          meta: `${t(provider.mode)} · ${t(provider.action)}`,
          status: provider.status,
          tone: provider.status === 'ready' ? 'success' : provider.status === 'blocked' ? 'danger' : 'warning',
        }))}
      />
      <DataTable
        title={t('Provider matrix')}
        description={t('Evidence, failure count, and recommended action for each provider.')}
        columns={tc(['Provider', 'Status', 'Mode', 'Detail', 'Evidence', 'Failures', 'Action'])}
        rows={providerRows}
        density="compact"
      />
      <DataTable
        title={t('Provider failures')}
        description={t('Only active failure details are surfaced here.')}
        columns={tc(['Provider', 'Check', 'State', 'Missing', 'Reason', 'Action'])}
        rows={
          failureRows.length > 0
            ? failureRows.slice(0, compact ? 8 : 16)
            : [['all', 'provider-readiness', <StatusBadge key="provider-failures-clear" lang={lang} value="ready" />, '-', 'No active provider failures', 'No action required']]
        }
        density="compact"
      />
      <DataTable
        title={t('Provider operations')}
        description={t('Commands and links used for local and required checks.')}
        columns={tc(['Provider', 'Operation', 'Kind', 'Target', 'Detail'])}
        rows={operationRows.slice(0, compact ? 10 : 24)}
        density="compact"
      />
      <DataTable
        title={t('Matrix evidence')}
        description={t('Latest matrix report and local provider depth evidence.')}
        columns={tc(['Matrix', 'State', 'Command', 'Detail'])}
        rows={[
          [
            'latest',
            <StatusBadge key="matrix-state" lang={lang} value={matrixState(status)} />,
            status.matrix.required ? 'host:provider-matrix -- --required' : 'host:provider-matrix',
            matrixDetail(status),
          ],
          [
            'local-provider-depth',
            <StatusBadge
              key="local-depth-state"
              lang={lang}
              value={status.matrix.localDepth.ok ? 'passed' : 'missing'}
            />,
            'host:local-provider-smoke',
            status.matrix.localDepth.present
              ? `${status.matrix.localDepth.checks} checks`
              : 'missing from provider matrix',
          ],
          ...matrixRows,
        ]}
        density="compact"
      />
    </AdminPanel>
  );
}

import { StatCard } from '@host/components/ProductShell';
import { DataTable } from '@host/components/ui';
import type { AdminWorkerStatusView } from '@host/lib/admin-worker-status';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import { StatusBadge } from './StatusBadge';
import { AdminPanel, HealthRowList, StatGrid } from './AdminPrimitives';

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return '-';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${Math.round(ms / 1000)}s`;
}

function queueState(status: AdminWorkerStatusView): string {
  if (status.queue.deadLettered > 0 || status.alerts.some((alert) => alert.severity === 'error')) {
    return 'blocked';
  }
  if (status.queue.failed > 0 || status.queue.queued > 0 || status.alerts.length > 0) {
    return 'warning';
  }
  return 'ready';
}

export function WorkerStatusPanel({
  status,
  title = 'Worker Status',
  description = 'Worker heartbeat、queue lag、dead letters 和 soak evidence 使用同一套后台状态口径。',
  compact = false,
  lang = 'zh',
}: {
  status?: AdminWorkerStatusView;
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

  const alertRows =
    status.alerts.length > 0
      ? status.alerts.slice(0, compact ? 4 : 8).map((alert) => [
          alert.code,
          <StatusBadge key={`${alert.code}:severity`} lang={lang} value={alert.severity} />,
          alert.metric,
          `${alert.value}/${alert.threshold}`,
          alert.message,
        ])
      : [['clear', <StatusBadge key="worker-alerts-clear" lang={lang} value="ready" />, '-', '-', 'No active worker alerts']];

  return (
    <AdminPanel title={title} description={description} contentClassName="grid gap-4">
      <StatGrid>
        <StatCard
          label={t('Worker')}
          value={status.status}
          tone={status.status === 'blocked' ? 'red' : status.status === 'warning' ? 'amber' : 'blue'}
        />
        <StatCard
          label={t('Heartbeat')}
          value={status.heartbeatStatus}
          tone={status.heartbeatStatus === 'blocked' ? 'red' : status.heartbeatStatus === 'warning' ? 'amber' : 'blue'}
        />
        <StatCard
          label={t('Queue')}
          value={`${status.queue.queued}/${status.queue.deadLettered}`}
          tone={queueState(status) === 'blocked' ? 'red' : queueState(status) === 'warning' ? 'amber' : 'blue'}
        />
        <StatCard
          label={t('Soak')}
          value={status.soak.status}
          tone={status.soak.status === 'passed' ? 'blue' : status.soak.status === 'missing' ? 'amber' : 'red'}
        />
      </StatGrid>
      <HealthRowList
        lang={lang}
        items={[
          {
            key: 'worker',
            title: 'Worker heartbeat',
            detail: status.heartbeatAt ? `${status.heartbeatAt} (${formatDuration(status.heartbeatAgeMs)})` : 'missing',
            meta: `threshold ${formatDuration(status.thresholds.heartbeatStaleMs)}`,
            status: status.heartbeatStatus,
            tone: status.heartbeatStatus === 'blocked' ? 'danger' : status.heartbeatStatus === 'warning' ? 'warning' : 'success',
          },
          {
            key: 'queue',
            title: 'Queue pressure',
            detail: `${status.queue.queued} queued · ${status.queue.processing} processing · ${status.queue.failed} failed`,
            meta: `${status.queue.deadLettered} dead`,
            status: queueState(status),
            tone: queueState(status) === 'blocked' ? 'danger' : queueState(status) === 'warning' ? 'warning' : 'success',
          },
          {
            key: 'soak',
            title: 'Worker soak',
            detail: status.soak.exists ? `${status.soak.processed}/${status.soak.enqueued} processed` : 'missing',
            meta: status.soak.exists ? formatDuration(status.soak.durationMs) : 'run host:worker-soak',
            status: status.soak.status,
            tone: status.soak.status === 'passed' ? 'success' : status.soak.status === 'missing' ? 'warning' : 'danger',
          },
        ]}
      />
      <DataTable
        title={t('Worker evidence')}
        description={t('Heartbeat, drain and soak evidence in one compact table.')}
        columns={tc(['Worker', 'State', 'Value', 'Action'])}
        rows={[
          [
            'worker_id',
            <StatusBadge key="worker-state" lang={lang} value={status.status} />,
            status.workerId,
            status.actions[0] ?? 'Worker is ready.',
          ],
          [
            'heartbeat',
            <StatusBadge key="heartbeat-state" lang={lang} value={status.heartbeatStatus} />,
            status.heartbeatAt
              ? `${status.heartbeatAt} (${formatDuration(status.heartbeatAgeMs)})`
              : 'missing',
            `stale threshold ${formatDuration(status.thresholds.heartbeatStaleMs)}`,
          ],
          [
            'last_drain',
            <StatusBadge key="last-drain-state" lang={lang} value={status.lastDrainAt ? 'ready' : 'missing'} />,
            status.lastDrainAt ?? 'missing',
            status.lastResult
              ? `${status.lastResult.processed} processed, ${status.lastResult.failed} failed, ${status.lastResult.deadLettered} dead-lettered`
              : 'Run worker drain or worker soak',
          ],
          [
            'soak',
            <StatusBadge key="soak-state" lang={lang} value={status.soak.status} />,
            status.soak.exists
              ? `${status.soak.processed}/${status.soak.enqueued} processed in ${formatDuration(status.soak.durationMs)}`
              : 'missing',
            status.soak.exists
              ? status.soak.reportPath ?? status.soak.latestPath
              : 'Run npm run host:worker-soak',
          ],
        ]}
        density="compact"
      />
      <DataTable
        title={t('Queue counters')}
        description={t('Current queue and lag values.')}
        columns={tc(['Queue', 'Value'])}
        rows={[
          ['queued', String(status.queue.queued)],
          ['processing', String(status.queue.processing)],
          ['failed', String(status.queue.failed)],
          ['dead_letter', String(status.queue.deadLettered)],
          ['oldest_pending_at', status.queue.oldestPendingAt ?? '-'],
          ['lag', `${status.queue.lagMs}ms / threshold ${status.thresholds.queueLagMs}ms`],
        ]}
        density="compact"
      />
      <DataTable
        title={t('Worker alerts')}
        description={t('Active alerts stay close to the queue evidence.')}
        columns={tc(['Alert', 'Severity', 'Metric', 'Value', 'Message'])}
        rows={alertRows}
        density="compact"
      />
    </AdminPanel>
  );
}

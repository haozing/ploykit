import type { ReactNode } from 'react';
import {
  Activity,
  Clock3,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { adminNav, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { HostPageSlot } from '@host/components/layout/HostPageSlot';
import { ActionQueue, StatGrid } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminRunsCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { AdminOperationsViewSnapshot } from '@host/lib/admin-module-operations';
import {
  cleanTableQuery,
  matchesExactFilter,
  matchesTextSearch,
  runWaitingExternalReason,
} from './OperationsPageUtils';
import { RunHistorySection } from './RunHistorySection';
import { RunQueueLanes } from './RunQueueLanes';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function AdminRunsOperationsPage({
  lang,
  snapshot,
  requeueRunAction,
  cancelRunAction,
  query,
  headerActions,
  mainBefore,
  mainAfter,
}: {
  lang: SupportedLanguage;
  snapshot: AdminOperationsViewSnapshot;
  requeueRunAction: AdminFormAction;
  cancelRunAction: AdminFormAction;
  query?: AdminTableQuery;
  headerActions?: ReactNode;
  mainBefore?: ReactNode;
  mainAfter?: ReactNode;
}) {
  const copy = getAdminRunsCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const allRuns = snapshot.records.runs;
  const filteredRuns = allRuns.filter(
    (run) =>
      matchesTextSearch(tableQuery.q, [
        run.id,
        run.name,
        run.moduleId,
        run.workspaceId ?? '',
        run.kind,
        run.status,
        run.progress,
        run.error?.code,
        run.error?.message,
      ]) &&
      matchesExactFilter(tableQuery.status, run.status) &&
      matchesExactFilter(tableQuery.type, run.kind)
  );
  const totalPages = Math.max(1, Math.ceil(filteredRuns.length / tableQuery.pageSize));
  const page = Math.min(Math.max(tableQuery.page, 1), totalPages);
  const pageStart = (page - 1) * tableQuery.pageSize;
  const runs = filteredRuns.slice(pageStart, pageStart + tableQuery.pageSize);
  const runningRuns = allRuns.filter((run) => run.status === 'running').length;
  const queuedRuns = allRuns.filter((run) => run.status === 'queued').length;
  const waitingExternal = allRuns.filter((run) =>
    runWaitingExternalReason(run).startsWith('waiting external')
  ).length;
  const failedRuns = allRuns.filter((run) => run.status === 'failed');
  const blockedRuns = allRuns.filter(
    (run) => run.status === 'failed' || runWaitingExternalReason(run).startsWith('waiting external')
  );
  const actionItems = blockedRuns.slice(0, 4).map((run) => {
    const reason = runWaitingExternalReason(run);
    return {
      key: run.id,
      title: run.name,
      description: `${run.moduleId} · ${reason}`,
      actionLabel: copy.openRun,
      href: localizedPath(lang, `/admin/runs/${run.id}`),
      status: run.status,
      tone: run.status === 'failed' ? ('danger' as const) : ('warning' as const),
      meta: run.workspaceId ?? 'product',
    };
  });

  return (
    <WorkspaceShell
      lang={lang}
      title={copy.title}
      subtitle={copy.subtitle}
      nav={adminNav}
      actions={
        headerActions ? <HostPageSlot slotId="header.actions">{headerActions}</HostPageSlot> : null
      }
    >
      <HostPageSlot slotId="main.before">{mainBefore}</HostPageSlot>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Running')}
          value={String(runningRuns)}
          helper={adminInlineText(lang, 'Currently executing')}
          tone="blue"
          icon={Activity}
        />
        <StatCard
          label={adminInlineText(lang, 'Queued')}
          value={String(queuedRuns)}
          helper={adminInlineText(lang, 'Waiting for worker capacity')}
          icon={Clock3}
        />
        <StatCard
          label={adminInlineText(lang, 'Failed')}
          value={String(failedRuns.length)}
          helper={adminInlineText(lang, 'Requires inspection')}
          tone={failedRuns.length > 0 ? 'red' : 'neutral'}
          icon={TriangleAlert}
        />
        <StatCard
          label={adminInlineText(lang, 'Waiting External')}
          value={String(waitingExternal)}
          helper={adminInlineText(lang, 'Provider, secret, quota, or rate limit')}
          tone={waitingExternal > 0 ? 'amber' : 'neutral'}
          icon={RotateCcw}
        />
      </StatGrid>

      {actionItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'Execution review')}
          description={adminInlineText(
            lang,
            'Runs that are failed or waiting on external systems are promoted here before the full history.'
          )}
          status="warning"
          items={actionItems}
        />
      ) : null}

      <RunQueueLanes
        lang={lang}
        running={runningRuns}
        queued={queuedRuns}
        failed={failedRuns.length}
        waitingExternal={waitingExternal}
      />
      <RunHistorySection
        lang={lang}
        tableQuery={tableQuery}
        allRuns={allRuns}
        filteredRuns={filteredRuns}
        runs={runs}
        page={page}
        totalPages={totalPages}
        cancelRunAction={cancelRunAction}
        requeueRunAction={requeueRunAction}
      />
      <HostPageSlot slotId="main.after">{mainAfter}</HostPageSlot>
    </WorkspaceShell>
  );
}

export { AdminRunDetailOperationsPage } from './RunDetailPage';

import Link from 'next/link';
import { Activity } from 'lucide-react';
import { ConfirmSubmitButton, DataTable, Pagination } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import {
  ActionPanel,
  AdminPanel,
  EntityListItem,
  FilterBar,
} from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { AdminOperationsViewSnapshot } from '@host/lib/admin-module-operations';
import type { AdminTableQuery } from '@host/lib/table-query';
import {
  FilterResultHint,
  adminListHref,
  runCanCancel,
  runCanRequeue,
  runStatusOptions,
  runWaitingExternalReason,
} from './OperationsPageUtils';

type AdminFormAction = (formData: FormData) => void | Promise<void>;
type AdminRunRow = AdminOperationsViewSnapshot['records']['runs'][number];

export function RunHistorySection({
  lang,
  tableQuery,
  allRuns,
  filteredRuns,
  runs,
  page,
  totalPages,
  cancelRunAction,
  requeueRunAction,
}: {
  lang: SupportedLanguage;
  tableQuery: Required<AdminTableQuery>;
  allRuns: readonly AdminRunRow[];
  filteredRuns: readonly AdminRunRow[];
  runs: readonly AdminRunRow[];
  page: number;
  totalPages: number;
  cancelRunAction: AdminFormAction;
  requeueRunAction: AdminFormAction;
}) {
  return (
    <>
      <AdminPanel
        title={adminInlineText(lang, 'Run history')}
        description={adminInlineText(
          lang,
          'Search execution records by run id, module, workspace, status, progress, or error text.'
        )}
        contentClassName="p-0"
      >
        <FilterBar
          lang={lang}
          embedded
          searchValue={tableQuery.q}
          searchPlaceholder="搜索运行 ID、名称、模块、workspace、错误或状态"
          filterValue={tableQuery.status}
          filterOptions={runStatusOptions}
          resetHref={localizedPath(lang, '/admin/runs')}
        />
        {tableQuery.type ? (
          <div className="flex items-center gap-2 border-b border-admin-border bg-admin-bg/35 px-4 py-2 text-xs text-admin-text-muted sm:px-5">
            <span>{adminInlineText(lang, 'Kind')}</span>
            <StatusBadge lang={lang} value={tableQuery.type} tone="info" />
          </div>
        ) : null}
        <div className="px-4 py-3 sm:px-5">
          <FilterResultHint lang={lang} visible={filteredRuns.length} total={allRuns.length} />
        </div>
        {runs.length === 0 ? <RunHistoryEmptyState lang={lang} /> : null}
        <RunDesktopTable
          lang={lang}
          runs={runs}
          cancelRunAction={cancelRunAction}
          requeueRunAction={requeueRunAction}
        />
        <RunMobileList lang={lang} runs={runs} />
      </AdminPanel>
      <Pagination
        page={page}
        totalPages={totalPages}
        previousHref={
          page > 1 ? adminListHref(lang, '/admin/runs', tableQuery, page - 1) : undefined
        }
        nextHref={
          page < totalPages ? adminListHref(lang, '/admin/runs', tableQuery, page + 1) : undefined
        }
      />
    </>
  );
}

function RunHistoryEmptyState({ lang }: { lang: SupportedLanguage }) {
  return (
    <div className="px-4 pb-4 sm:px-5">
      <ActionPanel
        title={adminInlineText(lang, 'No runs match this filter')}
        description={adminInlineText(
          lang,
          'clear_the_filter_return_to_modules_or_inspect_webhoo_bf318195'
        )}
        tone="warning"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={localizedPath(lang, '/admin/runs')}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Clear filters')}
            </Link>
            <Link
              href={localizedPath(lang, '/admin/modules')}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Open modules')}
            </Link>
            <Link
              href={localizedPath(lang, '/admin/webhooks')}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Open webhooks')}
            </Link>
          </div>
        }
      />
    </div>
  );
}

function RunDesktopTable({
  lang,
  runs,
  cancelRunAction,
  requeueRunAction,
}: {
  lang: SupportedLanguage;
  runs: readonly AdminRunRow[];
  cancelRunAction: AdminFormAction;
  requeueRunAction: AdminFormAction;
}) {
  return (
    <div className="hidden xl:block">
      <DataTable
        className="rounded-none border-x-0 border-b-0 shadow-none"
        columns={adminInlineColumns(lang, [
          'Run',
          'Module',
          'Workspace',
          'Status',
          'Progress',
          'Updated',
          'Next',
          'Action',
        ])}
        rows={runs.map((run) => [
          <div key={`${run.id}:run`} className="min-w-0">
            <Link
              href={localizedPath(lang, `/admin/runs/${run.id}`)}
              className="block truncate font-semibold text-admin-primary hover:underline"
            >
              {run.name}
            </Link>
            <div className="mt-1 truncate text-xs text-admin-text-muted">{run.id}</div>
          </div>,
          run.moduleId,
          run.workspaceId ?? 'product',
          <StatusBadge key={`${run.id}:status`} lang={lang} value={run.status} />,
          `${run.progress}% · ${run.attempt}/${run.maxAttempts}`,
          <span key={`${run.id}:updated`} className="text-xs text-admin-text-muted">
            {run.updatedAt}
          </span>,
          <span key={`${run.id}:next`} className="text-xs text-admin-text-muted">
            {runWaitingExternalReason(run)}
          </span>,
          <RunRowActions
            key={`${run.id}:actions`}
            lang={lang}
            run={run}
            cancelRunAction={cancelRunAction}
            requeueRunAction={requeueRunAction}
          />,
        ])}
        empty={adminInlineText(lang, 'No runs match this filter.')}
        minWidthClass="min-w-[1120px]"
      />
    </div>
  );
}

function RunRowActions({
  lang,
  run,
  cancelRunAction,
  requeueRunAction,
}: {
  lang: SupportedLanguage;
  run: AdminRunRow;
  cancelRunAction: AdminFormAction;
  requeueRunAction: AdminFormAction;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={cancelRunAction} className="inline-flex">
        <input type="hidden" name="runId" value={run.id} />
        <input
          type="hidden"
          name="reason"
          value={`Canceled from Admin Runs. Previous status: ${run.status}.`}
        />
        <ConfirmSubmitButton
          type="submit"
          className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
          disabled={!runCanCancel(run.status)}
          confirmation={adminInlineText(lang, 'cancel_run_value_168aaf4e', {
            value1: run.name,
          })}
        >
          {adminInlineText(lang, 'Cancel')}
        </ConfirmSubmitButton>
      </form>
      <form action={requeueRunAction} className="inline-flex">
        <input type="hidden" name="runId" value={run.id} />
        <ConfirmSubmitButton
          type="submit"
          className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
          disabled={!runCanRequeue(run.status)}
          confirmation={adminInlineText(lang, 'requeue_run_value_ed01ac7b', {
            value1: run.name,
          })}
        >
          {adminInlineText(lang, 'Requeue')}
        </ConfirmSubmitButton>
      </form>
    </div>
  );
}

function RunMobileList({ lang, runs }: { lang: SupportedLanguage; runs: readonly AdminRunRow[] }) {
  return (
    <div className="grid gap-1 px-2 py-2 xl:hidden">
      {runs.length > 0 ? (
        runs.map((run) => (
          <EntityListItem
            key={run.id}
            href={localizedPath(lang, `/admin/runs/${run.id}`)}
            title={run.name}
            subtitle={`${run.moduleId} · ${run.workspaceId ?? 'product'}`}
            status={run.status}
            detail={`${run.progress}% · ${runWaitingExternalReason(run)}`}
            meta={`${run.attempt}/${run.maxAttempts}`}
            icon={Activity}
            tone={run.status === 'failed' ? 'danger' : run.status === 'running' ? 'info' : 'primary'}
          />
        ))
      ) : (
        <div className="rounded-admin-md border border-dashed border-admin-border px-4 py-8 text-center text-sm text-admin-text-muted">
          {adminInlineText(lang, 'No runs match this filter.')}
        </div>
      )}
    </div>
  );
}

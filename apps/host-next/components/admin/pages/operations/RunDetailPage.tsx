import Link from 'next/link';
import type { ReactNode } from 'react';
import { adminNav, EmptyState, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { HostPageSlot } from '@host/components/layout/HostPageSlot';
import { ConfirmSubmitButton, DetailDrawer } from '@host/components/ui';
import { CopyButton } from '@host/components/ui/CopyButton';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import {
  ActionPanel,
  AdminPanel,
  CodeBlockPanel,
  FactList,
  TimelineList,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminRunDetailCopy } from '@host/lib/admin-copy';
import type { AdminRunDetailView } from '@host/lib/admin-runs';
import { redactSensitive } from '@/lib/module-runtime/observability/redaction';
import {
  compactJson,
  runCanCancel,
  runCanRequeue,
  runWaitingExternalReason,
} from './OperationsPageUtils';
import { RunLinkedEvidence } from './RunLinkedEvidence';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function AdminRunDetailOperationsPage({
  lang,
  detail,
  requeueRunAction,
  cancelRunAction,
  mainBefore,
  mainAfter,
  side,
}: {
  lang: SupportedLanguage;
  detail: AdminRunDetailView;
  requeueRunAction: AdminFormAction;
  cancelRunAction: AdminFormAction;
  mainBefore?: ReactNode;
  mainAfter?: ReactNode;
  side?: ReactNode;
}) {
  const copy = getAdminRunDetailCopy(lang);
  const run = detail.run;
  const correlationId =
    run?.idempotencyKey ??
    run?.costRef ??
    detail.outbox
      .map((record) => record.metadata.correlationId ?? record.metadata.causationId)
      .find(Boolean)
      ?.toString() ??
    run?.id ??
    'none';
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      {run ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            <HostPageSlot slotId="main.before">{mainBefore}</HostPageSlot>
            <StatGrid>
              <StatCard
                label={adminInlineText(lang, 'Status')}
                value={run.status}
                tone={run.status === 'failed' ? 'red' : 'blue'}
              />
              <StatCard label={adminInlineText(lang, 'Progress')} value={`${run.progress}%`} />
              <StatCard
                label={adminInlineText(lang, 'Attempts')}
                value={`${run.attempt}/${run.maxAttempts}`}
                tone="amber"
              />
              <StatCard
                label={adminInlineText(lang, 'Next')}
                value={runWaitingExternalReason(run)}
                tone={runWaitingExternalReason(run).startsWith('waiting') ? 'amber' : 'blue'}
              />
            </StatGrid>

            <ActionPanel
              title={run.name}
              description={`${run.moduleId} · ${run.kind} · correlation ${correlationId}`}
              tone={
                run.status === 'failed'
                  ? 'danger'
                  : runCanCancel(run.status)
                    ? 'warning'
                    : 'neutral'
              }
              actions={
                <>
                  <form action={cancelRunAction} className="inline-flex">
                    <input type="hidden" name="runId" value={run.id} />
                    <input
                      type="hidden"
                      name="reason"
                      value={`Canceled from Admin Run Detail. Previous status: ${run.status}.`}
                    />
                    <ConfirmSubmitButton
                      type="submit"
                      className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 px-4 py-2 text-sm font-semibold text-admin-danger transition hover:bg-admin-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
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
                      className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-admin-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                      disabled={!runCanRequeue(run.status)}
                      confirmation={adminInlineText(lang, 'requeue_run_value_ed01ac7b', {
                        value1: run.name,
                      })}
                    >
                      {adminInlineText(lang, 'Requeue')}
                    </ConfirmSubmitButton>
                  </form>
                </>
              }
            />

            <AdminPanel
              title={adminInlineText(lang, 'Runbook and escalation')}
              description={adminInlineText(
                lang,
                'Module, webhook, service, and audit links are visible before raw logs so failed runs have a clear next stop.'
              )}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={localizedPath(lang, `/admin/modules/${encodeURIComponent(run.moduleId)}`)}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Module')}
                  </Link>
                  <Link
                    href={localizedPath(
                      lang,
                      `/admin/webhooks?q=${encodeURIComponent(run.moduleId)}`
                    )}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Webhooks')}
                  </Link>
                  <Link
                    href={localizedPath(
                      lang,
                      `/admin/service-connections?q=${encodeURIComponent(run.moduleId)}`
                    )}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Service')}
                  </Link>
                  <Link
                    href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(run.id)}`)}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Audit')}
                  </Link>
                </div>
              }
            >
              <FactList
                lang={lang}
                density="compact"
                className="md:grid-cols-2"
                items={[
                  { label: 'Runbook', value: `modules/${run.moduleId}/README.md`, mono: true },
                  {
                    label: 'Escalation',
                    value: runWaitingExternalReason(run),
                    tone: runWaitingExternalReason(run).startsWith('waiting')
                      ? 'warning'
                      : 'neutral',
                  },
                  {
                    label: 'Module renderer slot',
                    value: 'host.page:admin.run-detail:main.before',
                    mono: true,
                  },
                  {
                    label: 'Side renderer slot',
                    value: 'host.page:admin.run-detail:side',
                    mono: true,
                  },
                ]}
              />
            </AdminPanel>

            <AdminPanel
              title={adminInlineText(lang, 'Execution timeline')}
              description={adminInlineText(
                lang,
                'Logs are shown as an event stream so failures can be scanned without reading raw payloads.'
              )}
            >
              <TimelineList
                lang={lang}
                items={run.logs.map((log, index) => ({
                  key: `${log.at}:${index}`,
                  title: log.message,
                  description: log.metadata ? compactJson(log.metadata, 180) : undefined,
                  meta: `${log.level} · ${log.at}`,
                  tone:
                    log.level === 'error' ? 'danger' : log.level === 'warn' ? 'warning' : 'primary',
                }))}
                empty={adminInlineText(lang, 'No logs recorded.')}
              />
            </AdminPanel>

            <RunLinkedEvidence lang={lang} detail={detail} />

            <div className="grid gap-5 xl:grid-cols-3">
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'Input')}
                description={adminInlineText(lang, 'Redacted execution input.')}
                value={JSON.stringify(redactSensitive(run.input ?? {}), null, 2)}
              />
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'Result')}
                description={adminInlineText(lang, 'Redacted execution output.')}
                value={JSON.stringify(redactSensitive(run.result ?? {}), null, 2)}
              />
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'Error')}
                description={adminInlineText(lang, 'Failure evidence when present.')}
                value={JSON.stringify(redactSensitive(run.error ?? {}), null, 2)}
              />
            </div>
            <HostPageSlot slotId="main.after">{mainAfter}</HostPageSlot>
          </div>

          <div className="grid gap-5 xl:sticky xl:top-24 xl:self-start">
            <HostPageSlot slotId="side">{side}</HostPageSlot>
            <DetailDrawer
              open
              title={adminInlineText(lang, 'Run snapshot')}
              description={run.id}
              actions={
                <CopyButton
                  value={run.id}
                  label={adminInlineText(lang, 'Copy ID')}
                  copiedLabel={adminInlineText(lang, 'Copied ID')}
                />
              }
            >
              <FactList
                lang={lang}
                items={[
                  { label: 'Run ID', value: run.id, copyValue: run.id, mono: true },
                  { label: 'Workspace', value: run.workspaceId ?? 'product', mono: true },
                  {
                    label: 'Correlation',
                    value: correlationId,
                    copyValue: correlationId,
                    mono: true,
                  },
                  { label: 'Idempotency', value: run.idempotencyKey ?? 'none', mono: true },
                  { label: 'Cost Ref', value: run.costRef ?? 'none', mono: true },
                  { label: 'Created', value: run.createdAt },
                  { label: 'Started', value: run.startedAt ?? 'not started' },
                  { label: 'Completed', value: run.completedAt ?? 'not completed' },
                  { label: 'Cancel Requested', value: run.cancelRequestedAt ?? 'not requested' },
                  { label: 'Updated', value: run.updatedAt },
                ]}
              />
            </DetailDrawer>
          </div>
        </div>
      ) : (
        <EmptyState title={copy.missingTitle}>{copy.missingBody}</EmptyState>
      )}
    </WorkspaceShell>
  );
}

import { Activity, AlertTriangle, CheckCircle2, FileCode2, Route, ServerCog } from 'lucide-react';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { PluginDevCopyButton } from '@/components/admin/plugin-dev-copy-button';
import { requireAdmin } from '@/lib/shared/role-check';
import {
  buildPluginDevConsoleReport,
  getPluginDiagnosticDisplay,
  type PluginDiagnosticDisplayField,
  type PluginDevPluginReport,
} from '@/lib/plugin-runtime/dev-console';
import type { PluginDiagnostic } from '@/plugin-sdk/diagnostics';
import type { RuntimeCheckResult } from '@/lib/runtime';
import { cn } from '@/lib/_core/utils';

export const dynamic = 'force-dynamic';

interface PluginDevConsoleLabels {
  copyDiagnostics: string;
  copyPluginDiagnostics: string;
  copied: string;
  noDiagnostics: string;
  none: string;
  pending: string;
  contractLoadFailed: string;
  sections: {
    contract: string;
    diagnostics: string;
    routesAndMenus: string;
    permissions: string;
    dataAndResources: string;
    runtimeSurface: string;
    activity: string;
    rawContract: string;
    jobs: string;
    events: string;
    webhooks: string;
  };
  fields: {
    version: string;
    kind: string;
    trust: string;
    pages: string;
    apis: string;
    menu: string;
    collections: string;
    resources: string;
  };
  statuses: Record<string, string>;
  activityNames: Record<string, string>;
  runtimeCheckMessages: Record<string, string>;
  runtimeChecks: {
    check: string;
    status: string;
    message: string;
  };
  runtimeActivity: {
    runtimeStatus: string;
    registered: string;
    recentRuns: string;
    attempts: string;
    publishes: string;
    subscriptions: string;
    listeners: string;
    retries: string;
  };
}

function translatedValue(value: string, labels: Record<string, string>): string {
  return labels[value] ?? value;
}

function runtimeCheckMessage(
  check: RuntimeCheckResult,
  labels: PluginDevConsoleLabels['runtimeCheckMessages']
): string {
  const template = labels[check.key];

  if (!template || template.startsWith('dashboard.pluginDevConsolePage.runtimeCheckMessages.')) {
    return check.message;
  }

  if (template) {
    return template
      .replace('{message}', check.message)
      .replace('{durationMs}', String(check.durationMs ?? 0));
  }

  return check.message;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ok' || status === 'ready') {
    return 'default';
  }

  if (status === 'failed' || status === 'error' || status === 'missing') {
    return 'destructive';
  }

  if (status === 'warning' || status === 'skipped') {
    return 'secondary';
  }

  return 'outline';
}

function SummaryTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  return (
    <div
      className={cn(
        'rounded-md border bg-background p-4',
        tone === 'good' && 'border-emerald-300 bg-emerald-50 text-emerald-950',
        tone === 'warn' && 'border-amber-300 bg-amber-50 text-amber-950',
        tone === 'bad' && 'border-destructive/40 bg-destructive/10 text-destructive'
      )}
    >
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function DiagnosticFields({ fields }: { fields: PluginDiagnosticDisplayField[] }) {
  if (fields.length === 0) {
    return null;
  }

  return (
    <dl className="mt-3 grid gap-2 text-xs md:grid-cols-2">
      {fields.map((field) => {
        const values = Array.isArray(field.value) ? field.value : [field.value];

        return (
          <div key={field.label} className="rounded-md bg-muted/40 p-2">
            <dt className="font-medium text-muted-foreground">{field.label}</dt>
            <dd className="mt-1">
              {values.length > 1 ? (
                <div className="flex flex-wrap gap-1">
                  {values.map((value) => (
                    <Badge key={value} variant="outline" className="font-mono text-[11px]">
                      {value}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="break-all font-mono">{values[0]}</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function DiagnosticsList({
  diagnostics,
  emptyLabel,
}: {
  diagnostics: PluginDiagnostic[];
  emptyLabel: string;
}) {
  if (diagnostics.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2">
      {diagnostics.map((diagnostic, index) => {
        const display = getPluginDiagnosticDisplay(diagnostic);

        return (
          <div key={`${diagnostic.code}-${index}`} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(diagnostic.severity)}>{diagnostic.severity}</Badge>
              <span className="font-mono text-sm font-semibold">{diagnostic.code}</span>
              {diagnostic.file && (
                <span className="font-mono text-xs text-muted-foreground">{diagnostic.file}</span>
              )}
            </div>
            <p className="mt-2 text-sm font-medium">{display.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{diagnostic.message}</p>
            {display.explanation && (
              <p className="mt-1 text-sm text-muted-foreground">{display.explanation}</p>
            )}
            <DiagnosticFields fields={display.fields} />
            {diagnostic.fix && (
              <p className="mt-2 text-sm text-muted-foreground">{diagnostic.fix}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RuntimeChecks({
  checks,
  labels,
  statusLabels,
  messageLabels,
}: {
  checks: RuntimeCheckResult[];
  labels: PluginDevConsoleLabels['runtimeChecks'];
  statusLabels: PluginDevConsoleLabels['statuses'];
  messageLabels: PluginDevConsoleLabels['runtimeCheckMessages'];
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="grid grid-cols-[160px_120px_1fr] border-b bg-muted/50 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
        <span>{labels.check}</span>
        <span>{labels.status}</span>
        <span>{labels.message}</span>
      </div>
      {checks.map((check) => (
        <div
          key={check.key}
          className="grid grid-cols-[160px_120px_1fr] gap-3 border-b px-3 py-3 text-sm last:border-b-0"
        >
          <span className="font-mono">{check.key}</span>
          <span>
            <Badge variant={statusVariant(check.status)}>
              {translatedValue(check.status, statusLabels)}
            </Badge>
          </span>
          <span className="text-muted-foreground">{runtimeCheckMessage(check, messageLabels)}</span>
        </div>
      ))}
    </div>
  );
}

function TinyList({ items, emptyLabel }: { items: unknown[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <span className="text-muted-foreground">{emptyLabel}</span>;
  }

  return (
    <ul className="space-y-1">
      {items.map((item, index) => (
        <li key={index} className="font-mono text-xs">
          {typeof item === 'string' ? item : JSON.stringify(item)}
        </li>
      ))}
    </ul>
  );
}

function shortDate(value: string | undefined, pendingLabel: string) {
  return value ? new Date(value).toLocaleString() : pendingLabel;
}

function RuntimeDetailList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-3 text-xs font-medium uppercase text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function RuntimeActivityDetails({
  plugin,
  labels,
}: {
  plugin: PluginDevPluginReport;
  labels: PluginDevConsoleLabels;
}) {
  const { jobs, events, webhooks } = plugin.activity;

  return (
    <section className="space-y-3 xl:col-span-2">
      <h3 className="text-sm font-semibold">{labels.runtimeActivity.runtimeStatus}</h3>
      <div className="grid gap-3 lg:grid-cols-3">
        <RuntimeDetailList title={labels.sections.jobs}>
          <div className="space-y-3 text-xs">
            <div>
              <div className="mb-1 text-muted-foreground">{labels.runtimeActivity.registered}</div>
              {jobs.registered.length > 0 ? (
                <div className="space-y-1">
                  {jobs.registered.map((job) => (
                    <div key={job.name} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{job.name}</span>
                      <Badge variant="outline">{job.priority}</Badge>
                      <span className="text-muted-foreground">{job.timeoutMs}ms</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">{labels.none}</span>
              )}
            </div>
            <div>
              <div className="mb-1 text-muted-foreground">{labels.runtimeActivity.recentRuns}</div>
              {jobs.items.length > 0 ? (
                <div className="space-y-2">
                  {jobs.items.map((run) => (
                    <div
                      key={run.id}
                      className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={statusVariant(run.status)}>
                          {translatedValue(run.status, labels.statuses)}
                        </Badge>
                        <span className="font-mono">{run.jobName}</span>
                      </div>
                      <div className="text-muted-foreground">
                        {labels.runtimeActivity.attempts} {run.attempts} ·{' '}
                        {shortDate(run.completedAt ?? run.startedAt, labels.pending)}
                      </div>
                      {run.error && <div className="text-destructive">{run.error}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">{labels.none}</span>
              )}
            </div>
          </div>
        </RuntimeDetailList>

        <RuntimeDetailList title={labels.sections.events}>
          <div className="space-y-3 text-xs">
            <div>
              <div className="mb-1 text-muted-foreground">{labels.runtimeActivity.publishes}</div>
              <TinyList items={events.publishes} emptyLabel={labels.none} />
            </div>
            <div>
              <div className="mb-1 text-muted-foreground">
                {labels.runtimeActivity.subscriptions}
              </div>
              {events.items.length > 0 ? (
                <div className="space-y-2">
                  {events.items.map((subscription) => (
                    <div
                      key={subscription.event}
                      className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={subscription.registered ? 'default' : 'destructive'}>
                          {translatedValue(
                            subscription.registered ? 'registered' : 'missing',
                            labels.statuses
                          )}
                        </Badge>
                        <span className="font-mono">{subscription.event}</span>
                      </div>
                      {subscription.handler && (
                        <div className="font-mono text-muted-foreground">
                          {subscription.handler}
                        </div>
                      )}
                      <div className="text-muted-foreground">
                        {labels.runtimeActivity.listeners} {subscription.listeners.length}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">{labels.none}</span>
              )}
            </div>
          </div>
        </RuntimeDetailList>

        <RuntimeDetailList title={labels.sections.webhooks}>
          {webhooks.items.length > 0 ? (
            <div className="space-y-2 text-xs">
              {webhooks.items.map((receipt) => (
                <div
                  key={receipt.id}
                  className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(receipt.status)}>
                      {translatedValue(receipt.status, labels.statuses)}
                    </Badge>
                    <span className="font-mono">{receipt.eventType}</span>
                  </div>
                  <div className="text-muted-foreground">
                    {labels.runtimeActivity.retries} {receipt.retryCount ?? 0} ·{' '}
                    {shortDate(receipt.processedAt ?? receipt.createdAt, labels.pending)}
                  </div>
                  {receipt.error && <div className="text-destructive">{receipt.error}</div>}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">{labels.none}</span>
          )}
        </RuntimeDetailList>
      </div>
    </section>
  );
}

function PluginPanel({
  plugin,
  labels,
}: {
  plugin: PluginDevPluginReport;
  labels: PluginDevConsoleLabels;
}) {
  const contract = plugin.contract;

  return (
    <article className="rounded-md border bg-background">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{contract?.name ?? plugin.pluginId}</h2>
            <Badge variant={plugin.success ? 'default' : 'destructive'}>
              {translatedValue(plugin.success ? 'passing' : 'failing', labels.statuses)}
            </Badge>
            <Badge variant={plugin.installation.enabled ? 'default' : 'secondary'}>
              {translatedValue(
                plugin.installation.enabled ? 'enabled' : plugin.installation.status,
                labels.statuses
              )}
            </Badge>
            <Badge variant="outline">{plugin.sourceTarget}</Badge>
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{plugin.pluginPath}</p>
          <p className="mt-1 text-xs text-muted-foreground">{plugin.installation.message}</p>
        </div>
        <PluginDevCopyButton
          value={JSON.stringify(
            {
              pluginId: plugin.pluginId,
              pluginPath: plugin.pluginPath,
              diagnostics: plugin.diagnostics.map((diagnostic) => ({
                ...diagnostic,
                display: getPluginDiagnosticDisplay(diagnostic),
              })),
            },
            null,
            2
          )}
          label={labels.copyPluginDiagnostics}
          copiedLabel={labels.copied}
        />
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[1fr_1fr]">
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <FileCode2 className="h-4 w-4" />
            {labels.sections.contract}
          </h3>
          {contract ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">ID</div>
                <div className="font-mono">{contract.id}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{labels.fields.version}</div>
                <div>{contract.version}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{labels.fields.kind}</div>
                <div>{contract.kind}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{labels.fields.trust}</div>
                <div>{translatedValue(contract.trustLevel ?? 'default', labels.statuses)}</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{labels.contractLoadFailed}</p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4" />
            {labels.sections.diagnostics}
          </h3>
          <DiagnosticsList diagnostics={plugin.diagnostics} emptyLabel={labels.noDiagnostics} />
        </section>

        {contract && (
          <>
            <section className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Route className="h-4 w-4" />
                {labels.sections.routesAndMenus}
              </h3>
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {labels.fields.pages}
                  </div>
                  <TinyList items={contract.routes.pages} emptyLabel={labels.none} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {labels.fields.apis}
                  </div>
                  <TinyList items={contract.routes.apis} emptyLabel={labels.none} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {labels.fields.menu}
                  </div>
                  <TinyList items={contract.menu} emptyLabel={labels.none} />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{labels.sections.permissions}</h3>
              <div className="flex flex-wrap gap-2">
                {contract.permissions.length > 0 ? (
                  contract.permissions.map((permission) => (
                    <Badge key={permission} variant="outline" className="font-mono">
                      {permission}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">{labels.none}</span>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{labels.sections.dataAndResources}</h3>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {labels.fields.collections}
                  </div>
                  <TinyList items={contract.data.collections} emptyLabel={labels.none} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {labels.fields.resources}
                  </div>
                  <TinyList
                    items={[
                      ...contract.resources.locales.map(
                        (locale) => `${locale.locale}: ${locale.path}`
                      ),
                      ...contract.resources.assets,
                    ]}
                    emptyLabel={labels.none}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ServerCog className="h-4 w-4" />
                {labels.sections.runtimeSurface}
              </h3>
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {labels.sections.jobs}
                  </div>
                  <TinyList items={contract.jobs} emptyLabel={labels.none} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {labels.sections.webhooks}
                  </div>
                  <TinyList items={contract.webhooks} emptyLabel={labels.none} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {labels.sections.events}
                  </div>
                  <TinyList
                    items={[
                      ...contract.events.publishes,
                      ...contract.events.subscribes.map(
                        (subscription) => `${subscription.event} -> ${subscription.handler}`
                      ),
                    ]}
                    emptyLabel={labels.none}
                  />
                </div>
              </div>
            </section>
          </>
        )}

        <section className="space-y-3 xl:col-span-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4" />
            {labels.sections.activity}
          </h3>
          <div className="grid gap-3 md:grid-cols-4">
            {Object.entries({
              audit: plugin.activity.audit,
              usage: plugin.activity.usage,
              jobs: plugin.activity.jobs,
              events: plugin.activity.events,
              webhooks: plugin.activity.webhooks,
            }).map(([name, section]) => (
              <div key={name} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {translatedValue(name, labels.activityNames)}
                  </span>
                  <Badge variant={statusVariant(section.status)}>
                    {translatedValue(section.status, labels.statuses)}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{section.message}</p>
              </div>
            ))}
          </div>
        </section>

        <RuntimeActivityDetails plugin={plugin} labels={labels} />

        <section className="space-y-3 xl:col-span-2">
          <h3 className="text-sm font-semibold">{labels.sections.rawContract}</h3>
          <JsonBlock value={contract?.raw ?? null} />
        </section>
      </div>
    </article>
  );
}

export default async function PluginDevConsolePage() {
  await requireAdmin();

  const t = await getTranslations('dashboard.pluginDevConsolePage');
  const report = await buildPluginDevConsoleReport();
  const labels: PluginDevConsoleLabels = {
    copyDiagnostics: t('copyDiagnostics'),
    copyPluginDiagnostics: t('copyPluginDiagnostics'),
    copied: t('copied'),
    noDiagnostics: t('noDiagnostics'),
    none: t('none'),
    pending: t('pending'),
    contractLoadFailed: t('contractLoadFailed'),
    sections: {
      contract: t('sections.contract'),
      diagnostics: t('sections.diagnostics'),
      routesAndMenus: t('sections.routesAndMenus'),
      permissions: t('sections.permissions'),
      dataAndResources: t('sections.dataAndResources'),
      runtimeSurface: t('sections.runtimeSurface'),
      activity: t('sections.activity'),
      rawContract: t('sections.rawContract'),
      jobs: t('sections.jobs'),
      events: t('sections.events'),
      webhooks: t('sections.webhooks'),
    },
    fields: {
      version: t('fields.version'),
      kind: t('fields.kind'),
      trust: t('fields.trust'),
      pages: t('fields.pages'),
      apis: t('fields.apis'),
      menu: t('fields.menu'),
      collections: t('fields.collections'),
      resources: t('fields.resources'),
    },
    statuses: {
      passing: t('statuses.passing'),
      failing: t('statuses.failing'),
      enabled: t('statuses.enabled'),
      disabled: t('statuses.disabled'),
      ok: t('statuses.ok'),
      ready: t('statuses.ready'),
      failed: t('statuses.failed'),
      error: t('statuses.error'),
      missing: t('statuses.missing'),
      warning: t('statuses.warning'),
      skipped: t('statuses.skipped'),
      registered: t('statuses.registered'),
      default: t('statuses.default'),
      trusted: t('statuses.trusted'),
      untrusted: t('statuses.untrusted'),
      system: t('statuses.system'),
    },
    activityNames: {
      audit: t('activityNames.audit'),
      usage: t('activityNames.usage'),
      jobs: t('activityNames.jobs'),
      events: t('activityNames.events'),
      webhooks: t('activityNames.webhooks'),
    },
    runtimeCheckMessages: {
      env: t('runtimeCheckMessages.env'),
      db: t('runtimeCheckMessages.db'),
      'plugin-map': t('runtimeCheckMessages.pluginMap'),
      rls: t('runtimeCheckMessages.rls'),
      security: t('runtimeCheckMessages.security'),
      storage: t('runtimeCheckMessages.storage'),
      'plugin-storage': t('runtimeCheckMessages.pluginStorage'),
      'plugin-runtime': t('runtimeCheckMessages.pluginRuntime'),
      outbox: t('runtimeCheckMessages.outbox'),
      'audit-usage': t('runtimeCheckMessages.auditUsage'),
      'plugin-capabilities': t('runtimeCheckMessages.pluginCapabilities'),
    },
    runtimeChecks: {
      check: t('runtimeChecks.check'),
      status: t('runtimeChecks.status'),
      message: t('runtimeChecks.message'),
    },
    runtimeActivity: {
      runtimeStatus: t('runtimeActivity.runtimeStatus'),
      registered: t('runtimeActivity.registered'),
      recentRuns: t('runtimeActivity.recentRuns'),
      attempts: t('runtimeActivity.attempts'),
      publishes: t('runtimeActivity.publishes'),
      subscriptions: t('runtimeActivity.subscriptions'),
      listeners: t('runtimeActivity.listeners'),
      retries: t('runtimeActivity.retries'),
    },
  };
  const copyPayload = JSON.stringify(
    {
      generatedAt: report.generatedAt,
      summary: report.summary,
      legacy: report.legacy,
      targets: report.targets,
      runtime: report.runtime,
      diagnostics: report.plugins.flatMap((plugin) =>
        plugin.diagnostics.map((diagnostic) => ({
          pluginId: plugin.pluginId,
          pluginPath: plugin.pluginPath,
          ...diagnostic,
        }))
      ),
    },
    null,
    2
  );

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
            <Badge variant={report.summary.errors > 0 ? 'destructive' : 'default'}>
              {report.summary.errors > 0 ? t('status.needsRepair') : t('status.healthy')}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('generatedAt', { time: new Date(report.generatedAt).toLocaleString() })}
          </p>
        </div>
        <PluginDevCopyButton
          value={copyPayload}
          label={labels.copyDiagnostics}
          copiedLabel={labels.copied}
        />
      </header>

      <section className="grid gap-3 md:grid-cols-5">
        <SummaryTile label={t('summary.plugins')} value={report.summary.totalPlugins} />
        <SummaryTile
          label={t('summary.passing')}
          value={report.summary.passingPlugins}
          tone="good"
        />
        <SummaryTile
          label={t('summary.failing')}
          value={report.summary.failingPlugins}
          tone={report.summary.failingPlugins > 0 ? 'bad' : 'neutral'}
        />
        <SummaryTile
          label={t('summary.diagnostics')}
          value={report.summary.diagnostics}
          tone={report.summary.diagnostics > 0 ? 'warn' : 'neutral'}
        />
        <SummaryTile
          label={t('summary.legacy')}
          value={report.summary.legacyPluginDirectories}
          tone={report.summary.legacyPluginDirectories > 0 ? 'warn' : 'neutral'}
        />
      </section>

      <section className="rounded-md border bg-background p-5">
        <div className="mb-4 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          <h2 className="text-lg font-semibold">{t('runtimeReconcile')}</h2>
          {report.runtime && (
            <Badge variant={statusVariant(report.runtime.overall)}>
              {translatedValue(report.runtime.overall, labels.statuses)}
            </Badge>
          )}
        </div>
        {report.runtime ? (
          <RuntimeChecks
            checks={report.runtime.checks}
            labels={labels.runtimeChecks}
            statusLabels={labels.statuses}
            messageLabels={labels.runtimeCheckMessages}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('runtimeUnavailable')}</p>
        )}
      </section>

      {report.legacy.length > 0 && (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-5 text-amber-950">
          <h2 className="text-lg font-semibold">{t('legacyManifestDirectories')}</h2>
          <TinyList items={report.legacy} emptyLabel={labels.none} />
        </section>
      )}

      <section className="space-y-5">
        {report.plugins.length > 0 ? (
          report.plugins.map((plugin) => (
            <PluginPanel key={plugin.pluginPath} plugin={plugin} labels={labels} />
          ))
        ) : (
          <div className="rounded-md border p-8 text-center text-muted-foreground">
            {t('noPlugins', { targets: report.targetPaths.join(', ') || 'configured targets' })}
          </div>
        )}
      </section>
    </div>
  );
}

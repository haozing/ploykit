import { Activity, AlertTriangle, CheckCircle2, FileCode2, Route, ServerCog } from 'lucide-react';
import type { ReactNode } from 'react';
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

function DiagnosticsList({ diagnostics }: { diagnostics: PluginDiagnostic[] }) {
  if (diagnostics.length === 0) {
    return <p className="text-sm text-muted-foreground">No diagnostics.</p>;
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

function RuntimeChecks({ checks }: { checks: RuntimeCheckResult[] }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="grid grid-cols-[160px_120px_1fr] border-b bg-muted/50 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
        <span>Check</span>
        <span>Status</span>
        <span>Message</span>
      </div>
      {checks.map((check) => (
        <div
          key={check.key}
          className="grid grid-cols-[160px_120px_1fr] gap-3 border-b px-3 py-3 text-sm last:border-b-0"
        >
          <span className="font-mono">{check.key}</span>
          <span>
            <Badge variant={statusVariant(check.status)}>{check.status}</Badge>
          </span>
          <span className="text-muted-foreground">{check.message}</span>
        </div>
      ))}
    </div>
  );
}

function TinyList({ items }: { items: unknown[] }) {
  if (items.length === 0) {
    return <span className="text-muted-foreground">None</span>;
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

function shortDate(value?: string) {
  return value ? new Date(value).toLocaleString() : 'pending';
}

function RuntimeDetailList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-3 text-xs font-medium uppercase text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function RuntimeActivityDetails({ plugin }: { plugin: PluginDevPluginReport }) {
  const { jobs, events, webhooks } = plugin.activity;

  return (
    <section className="space-y-3 xl:col-span-2">
      <h3 className="text-sm font-semibold">Runtime Status</h3>
      <div className="grid gap-3 lg:grid-cols-3">
        <RuntimeDetailList title="Jobs">
          <div className="space-y-3 text-xs">
            <div>
              <div className="mb-1 text-muted-foreground">Registered</div>
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
                <span className="text-muted-foreground">None</span>
              )}
            </div>
            <div>
              <div className="mb-1 text-muted-foreground">Recent Runs</div>
              {jobs.items.length > 0 ? (
                <div className="space-y-2">
                  {jobs.items.map((run) => (
                    <div
                      key={run.id}
                      className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                        <span className="font-mono">{run.jobName}</span>
                      </div>
                      <div className="text-muted-foreground">
                        attempts {run.attempts} · {shortDate(run.completedAt ?? run.startedAt)}
                      </div>
                      {run.error && <div className="text-destructive">{run.error}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </div>
          </div>
        </RuntimeDetailList>

        <RuntimeDetailList title="Events">
          <div className="space-y-3 text-xs">
            <div>
              <div className="mb-1 text-muted-foreground">Publishes</div>
              <TinyList items={events.publishes} />
            </div>
            <div>
              <div className="mb-1 text-muted-foreground">Subscriptions</div>
              {events.items.length > 0 ? (
                <div className="space-y-2">
                  {events.items.map((subscription) => (
                    <div
                      key={subscription.event}
                      className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={subscription.registered ? 'default' : 'destructive'}>
                          {subscription.registered ? 'registered' : 'missing'}
                        </Badge>
                        <span className="font-mono">{subscription.event}</span>
                      </div>
                      {subscription.handler && (
                        <div className="font-mono text-muted-foreground">
                          {subscription.handler}
                        </div>
                      )}
                      <div className="text-muted-foreground">
                        listeners {subscription.listeners.length}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </div>
          </div>
        </RuntimeDetailList>

        <RuntimeDetailList title="Webhooks">
          {webhooks.items.length > 0 ? (
            <div className="space-y-2 text-xs">
              {webhooks.items.map((receipt) => (
                <div
                  key={receipt.id}
                  className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(receipt.status)}>{receipt.status}</Badge>
                    <span className="font-mono">{receipt.eventType}</span>
                  </div>
                  <div className="text-muted-foreground">
                    retries {receipt.retryCount ?? 0} ·{' '}
                    {shortDate(receipt.processedAt ?? receipt.createdAt)}
                  </div>
                  {receipt.error && <div className="text-destructive">{receipt.error}</div>}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">None</span>
          )}
        </RuntimeDetailList>
      </div>
    </section>
  );
}

function PluginPanel({ plugin }: { plugin: PluginDevPluginReport }) {
  const contract = plugin.contract;

  return (
    <article className="rounded-md border bg-background">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{contract?.name ?? plugin.pluginId}</h2>
            <Badge variant={plugin.success ? 'default' : 'destructive'}>
              {plugin.success ? 'passing' : 'failing'}
            </Badge>
            <Badge variant={plugin.installation.enabled ? 'default' : 'secondary'}>
              {plugin.installation.enabled ? 'enabled' : plugin.installation.status}
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
          label="Copy plugin diagnostics"
        />
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[1fr_1fr]">
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <FileCode2 className="h-4 w-4" />
            Contract
          </h3>
          {contract ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">ID</div>
                <div className="font-mono">{contract.id}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Version</div>
                <div>{contract.version}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Kind</div>
                <div>{contract.kind}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Trust</div>
                <div>{contract.trustLevel ?? 'default'}</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Contract could not be loaded.</p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Diagnostics
          </h3>
          <DiagnosticsList diagnostics={plugin.diagnostics} />
        </section>

        {contract && (
          <>
            <section className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Route className="h-4 w-4" />
                Routes And Menus
              </h3>
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Pages</div>
                  <TinyList items={contract.routes.pages} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">APIs</div>
                  <TinyList items={contract.routes.apis} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Menu</div>
                  <TinyList items={contract.menu} />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Permissions</h3>
              <div className="flex flex-wrap gap-2">
                {contract.permissions.length > 0 ? (
                  contract.permissions.map((permission) => (
                    <Badge key={permission} variant="outline" className="font-mono">
                      {permission}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">None</span>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Data And Resources</h3>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Collections</div>
                  <TinyList items={contract.data.collections} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Resources</div>
                  <TinyList
                    items={[
                      ...contract.resources.locales.map(
                        (locale) => `${locale.locale}: ${locale.path}`
                      ),
                      ...contract.resources.assets,
                    ]}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ServerCog className="h-4 w-4" />
                Runtime Surface
              </h3>
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Jobs</div>
                  <TinyList items={contract.jobs} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Webhooks</div>
                  <TinyList items={contract.webhooks} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Events</div>
                  <TinyList
                    items={[
                      ...contract.events.publishes,
                      ...contract.events.subscribes.map(
                        (subscription) => `${subscription.event} -> ${subscription.handler}`
                      ),
                    ]}
                  />
                </div>
              </div>
            </section>
          </>
        )}

        <section className="space-y-3 xl:col-span-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4" />
            Activity
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
                  <span className="text-sm font-medium capitalize">{name}</span>
                  <Badge variant={statusVariant(section.status)}>{section.status}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{section.message}</p>
              </div>
            ))}
          </div>
        </section>

        <RuntimeActivityDetails plugin={plugin} />

        <section className="space-y-3 xl:col-span-2">
          <h3 className="text-sm font-semibold">Raw Contract</h3>
          <JsonBlock value={contract?.raw ?? null} />
        </section>
      </div>
    </article>
  );
}

export default async function PluginDevConsolePage() {
  await requireAdmin();

  const report = await buildPluginDevConsoleReport();
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
            <h1 className="text-3xl font-bold text-foreground">Plugin Dev Console</h1>
            <Badge variant={report.summary.errors > 0 ? 'destructive' : 'default'}>
              {report.summary.errors > 0 ? 'needs repair' : 'healthy'}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Generated at {new Date(report.generatedAt).toLocaleString()}
          </p>
        </div>
        <PluginDevCopyButton value={copyPayload} />
      </header>

      <section className="grid gap-3 md:grid-cols-5">
        <SummaryTile label="Plugins" value={report.summary.totalPlugins} />
        <SummaryTile label="Passing" value={report.summary.passingPlugins} tone="good" />
        <SummaryTile
          label="Failing"
          value={report.summary.failingPlugins}
          tone={report.summary.failingPlugins > 0 ? 'bad' : 'neutral'}
        />
        <SummaryTile
          label="Diagnostics"
          value={report.summary.diagnostics}
          tone={report.summary.diagnostics > 0 ? 'warn' : 'neutral'}
        />
        <SummaryTile
          label="Legacy"
          value={report.summary.legacyPluginDirectories}
          tone={report.summary.legacyPluginDirectories > 0 ? 'warn' : 'neutral'}
        />
      </section>

      <section className="rounded-md border bg-background p-5">
        <div className="mb-4 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          <h2 className="text-lg font-semibold">Runtime Reconcile</h2>
          {report.runtime && (
            <Badge variant={statusVariant(report.runtime.overall)}>{report.runtime.overall}</Badge>
          )}
        </div>
        {report.runtime ? (
          <RuntimeChecks checks={report.runtime.checks} />
        ) : (
          <p className="text-sm text-muted-foreground">Runtime report unavailable.</p>
        )}
      </section>

      {report.legacy.length > 0 && (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-5 text-amber-950">
          <h2 className="text-lg font-semibold">Legacy Manifest Directories</h2>
          <TinyList items={report.legacy} />
        </section>
      )}

      <section className="space-y-5">
        {report.plugins.length > 0 ? (
          report.plugins.map((plugin) => <PluginPanel key={plugin.pluginPath} plugin={plugin} />)
        ) : (
          <div className="rounded-md border p-8 text-center text-muted-foreground">
            No definePlugin contracts found in{' '}
            {report.targetPaths.join(', ') || 'configured targets'}.
          </div>
        )}
      </section>
    </div>
  );
}

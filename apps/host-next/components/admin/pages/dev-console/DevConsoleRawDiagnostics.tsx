import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import { DataTable } from '@host/components/ui';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminModuleDevConsoleView } from '@host/lib/admin-module-dev-console';

export function DevConsoleRawDiagnostics({
  lang,
  view,
}: {
  lang: SupportedLanguage;
  view: AdminModuleDevConsoleView;
}) {
  const reportByModule = new Map(view.testReports.map((report) => [report.moduleId, report]));

  return (
    <details className="rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-card">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted/60 [&::-webkit-details-marker]:hidden">
        {adminInlineText(lang, 'Raw diagnostic tables')}
      </summary>
      <div className="grid gap-4 border-t border-admin-border p-4">
        <AdminPanel
          title={adminInlineText(lang, 'Module map')}
          description={adminInlineText(
            lang,
            'Contract-level module map with test evidence and declared capabilities.'
          )}
          contentClassName="p-0"
        >
          <DataTable
            className="rounded-none border-x-0 border-b-0 shadow-none"
            columns={adminInlineColumns(lang, [
              'Module',
              'Status',
              'Routes',
              'Data',
              'Background',
              'module:test',
            ])}
            rows={view.snapshot.modules.map((module) => {
              const capabilities = module.capabilities;
              const testReport = reportByModule.get(module.id);
              return [
                module.id,
                module.status,
                String(capabilities?.routes ?? 0),
                `${capabilities?.data.tables ?? 0} tables / ${capabilities?.data.documents ?? 0} docs`,
                `${capabilities?.jobs ?? 0} jobs / ${capabilities?.webhooks ?? 0} webhooks`,
                testReport
                  ? `${testReport.success ? 'pass' : 'fail'} · ${testReport.checkedAt}`
                  : `npm run module:test -- ${module.id}`,
              ];
            })}
          />
        </AdminPanel>

        <DataTable
          title={adminInlineText(lang, 'Templates')}
          description={adminInlineText(
            lang,
            'Available local module scaffolds for new product capabilities.'
          )}
          columns={adminInlineColumns(lang, ['Template', 'Path', 'Capabilities'])}
          rows={view.report.templates.map((template) => [
            template.id,
            template.path,
            template.capabilities.join(', '),
          ])}
        />

        <DataTable
          title={adminInlineText(lang, 'Bundle inspect')}
          description={adminInlineText(lang, 'Scanned module files by capability surface.')}
          columns={adminInlineColumns(lang, ['Bundle Module', 'Source', 'Files'])}
          rows={view.bundle.modules.map((module) => [
            module.id,
            module.rootDir ?? 'unknown',
            [
              module.files.pages.length ? `${module.files.pages.length} pages` : null,
              module.files.apis.length ? `${module.files.apis.length} apis` : null,
              module.files.actions.length ? `${module.files.actions.length} actions` : null,
              module.files.jobs.length ? `${module.files.jobs.length} jobs` : null,
              module.files.webhooks.length ? `${module.files.webhooks.length} webhooks` : null,
            ]
              .filter(Boolean)
              .join(', ') || 'module only',
          ])}
        />

        <DataTable
          title={adminInlineText(lang, 'AI authoring prompts')}
          description={adminInlineText(
            lang,
            'Module diagnostics and prompt hints for AI-assisted fixes.'
          )}
          columns={adminInlineColumns(lang, [
            'Module',
            'Diagnostics',
            'AI-assisted authoring prompt',
          ])}
          rows={view.snapshot.modules.map((module) => {
            const diagnostics = view.diagnosticsByModule[module.id] ?? [];
            return [
              module.id,
              diagnostics.length > 0
                ? diagnostics.map((item) => `${item.severity}:${item.code}`).join(', ')
                : 'clean',
              view.report.aiFixPrompts[module.id] ??
                'Use defineModule(), local module handlers and explicit ctx capabilities only.',
            ];
          })}
        />
      </div>
    </details>
  );
}

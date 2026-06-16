import { AdminPanel, FactList } from '@host/components/admin/shared/AdminPrimitives';
import { DataTable } from '@host/components/ui';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminModuleDevConsoleView } from '@host/lib/admin-module-dev-console';

export function DevConsoleEnvironmentPanel({
  lang,
  view,
}: {
  lang: SupportedLanguage;
  view: AdminModuleDevConsoleView;
}) {
  const testedModules = new Set(
    view.testReports.filter((report) => report.success).map((report) => report.moduleId)
  );
  const modulesWithDiagnostics = view.snapshot.modules.filter(
    (module) => (view.diagnosticsByModule[module.id] ?? []).length > 0
  );

  return (
    <AdminPanel
      title={adminInlineText(lang, 'Environment comparison')}
      description={adminInlineText(
        lang,
        'mdc_does_not_have_a_remote_environment_contract_yet__9d34727c'
      )}
    >
      <div className="grid gap-4">
        <FactList
          lang={lang}
          density="compact"
          className="md:grid-cols-2 xl:grid-cols-4"
          items={[
            { label: 'Current env', value: view.environment.currentEnvironment },
            { label: 'Node env', value: view.environment.nodeEnvironment },
            { label: 'Target env', value: view.environment.targetEnvironment },
            {
              label: 'Module map',
              value: `${view.environment.moduleMapKind} · ${view.environment.moduleMapBuildId ?? 'no build id'}`,
            },
          ]}
        />
        <DataTable
          className="shadow-none"
          columns={adminInlineColumns(lang, ['Lane', 'Status', 'Evidence', 'Next check'])}
          rows={[
            [
              'Runtime',
              view.report.modulesWithErrors.length > 0 ? 'review' : 'ready',
              `${view.snapshot.moduleCount} modules · ${view.report.modulesWithErrors.length} error modules`,
              'npm run typecheck',
            ],
            [
              'Module map',
              view.environment.moduleMapGeneratedAt ? 'generated' : 'missing timestamp',
              `${view.environment.moduleMapKind} · ${view.environment.moduleMapGeneratedAt ?? 'not generated'}`,
              'npm run modules:scan',
            ],
            [
              'Module tests',
              testedModules.size === view.snapshot.moduleCount ? 'covered' : 'partial',
              `${testedModules.size}/${view.snapshot.moduleCount} modules have passing module:test reports`,
              'npm run module:test -- <module-id>',
            ],
            [
              'Production target',
              modulesWithDiagnostics.length > 0 ? 'blocked' : 'ready',
              `${modulesWithDiagnostics.length} modules have diagnostics before ${view.environment.targetEnvironment}`,
              'npm run release:rc-gate',
            ],
          ]}
          minWidthClass="min-w-[860px]"
          density="compact"
        />
      </div>
    </AdminPanel>
  );
}

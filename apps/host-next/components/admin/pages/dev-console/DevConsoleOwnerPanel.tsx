import Link from 'next/link';
import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import { DataTable } from '@host/components/ui';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminModuleDevConsoleView } from '@host/lib/admin-module-dev-console';
import { moduleEscalation, moduleOwner, moduleRunbook } from './DevConsolePageModel';

export function DevConsoleOwnerPanel({
  lang,
  view,
}: {
  lang: SupportedLanguage;
  view: AdminModuleDevConsoleView;
}) {
  return (
    <AdminPanel
      title={adminInlineText(lang, 'Owner, runbook, and escalation')}
      description={adminInlineText(
        lang,
        'module_owner_readme_runbook_escalation_and_linked_ru_df2711d0'
      )}
      contentClassName="p-0"
    >
      <DataTable
        className="rounded-none border-x-0 border-b-0 shadow-none"
        columns={adminInlineColumns(lang, ['Module', 'Owner', 'Runbook', 'Escalation', 'Links'])}
        rows={view.snapshot.modules.map((module) => {
          const diagnostics = view.diagnosticsByModule[module.id] ?? [];
          return [
            module.id,
            moduleOwner(module),
            <span key={`${module.id}:runbook`} className="font-mono text-xs text-admin-text-muted">
              {moduleRunbook(module)}
            </span>,
            moduleEscalation(lang, diagnostics),
            <div key={`${module.id}:links`} className="flex flex-wrap gap-2">
              <Link
                href={localizedPath(lang, `/admin/modules/${module.id}`)}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
              >
                {adminInlineText(lang, 'Module')}
              </Link>
              <Link
                href={`${localizedPath(lang, '/admin/runs')}?q=${encodeURIComponent(module.id)}`}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
              >
                {adminInlineText(lang, 'Runs')}
              </Link>
            </div>,
          ];
        })}
        minWidthClass="min-w-[980px]"
      />
    </AdminPanel>
  );
}

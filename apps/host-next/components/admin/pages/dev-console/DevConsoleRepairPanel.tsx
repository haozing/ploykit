import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import { DataTable } from '@host/components/ui';
import { CopyButton } from '@host/components/ui/CopyButton';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminModuleDevConsoleView } from '@host/lib/admin-module-dev-console';
import { buildRepairPacks } from './DevConsolePageModel';

export function DevConsoleRepairPanel({
  lang,
  view,
}: {
  lang: SupportedLanguage;
  view: AdminModuleDevConsoleView;
}) {
  const repairPacks = buildRepairPacks(lang, view);

  return (
    <AdminPanel
      title={adminInlineText(lang, 'AI repair workflow')}
      description={adminInlineText(
        lang,
        'each_module_has_a_copyable_repair_pack_with_diagnost_f986abc5'
      )}
      contentClassName="p-0"
    >
      <DataTable
        className="rounded-none border-x-0 border-b-0 shadow-none"
        columns={adminInlineColumns(lang, ['Module', 'Diagnostics', 'Commands', 'Repair pack'])}
        rows={repairPacks.map((entry) => [
          entry.module.id,
          entry.diagnostics.length > 0
            ? entry.diagnostics
                .map((diagnostic) => `${diagnostic.severity}:${diagnostic.code}`)
                .join(', ')
            : 'clean',
          <span
            key={`${entry.module.id}:commands`}
            className="whitespace-pre-wrap font-mono text-xs text-admin-text-muted"
          >
            {entry.commands.join('\n')}
          </span>,
          <CopyButton
            key={`${entry.module.id}:pack`}
            value={entry.pack}
            label={adminInlineText(lang, 'Copy')}
            copiedLabel={adminInlineText(lang, 'Copied')}
          />,
        ])}
        minWidthClass="min-w-[920px]"
      />
    </AdminPanel>
  );
}

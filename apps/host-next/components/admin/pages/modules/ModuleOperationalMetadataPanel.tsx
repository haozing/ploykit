import Link from 'next/link';
import { AdminPanel, FactList } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { type AdminModuleDetailContract, type AdminModuleDetailModule } from './ModuleDetailEvidenceModel';
import { getModuleProductArea } from './ModulePageModel';

export function ModuleOperationalMetadataPanel({
  lang,
  module,
  contract,
}: {
  lang: SupportedLanguage;
  module: AdminModuleDetailModule;
  contract: AdminModuleDetailContract;
}) {
  return (
    <AdminPanel
      title={adminInlineText(lang, 'Operational metadata')}
      description={adminInlineText(
        lang,
        'Owner, runbook, replacement, and related operational links are explicit here; missing contract metadata is surfaced as release evidence debt.'
      )}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={localizedPath(lang, `/admin/runs?q=${encodeURIComponent(module.id)}`)}
            className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
          >
            {adminInlineText(lang, 'Runs')}
          </Link>
          <Link
            href={localizedPath(lang, `/admin/webhooks?q=${encodeURIComponent(module.id)}`)}
            className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
          >
            {adminInlineText(lang, 'Webhooks')}
          </Link>
          <Link
            href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(module.id)}`)}
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
        className="md:grid-cols-2 xl:grid-cols-4"
        items={[
          {
            label: 'Owner',
            value: 'module contract owner metadata missing',
            tone: 'warning',
          },
          {
            label: 'Runbook',
            value: contract?.rootDir ? `${contract.rootDir}/README.md` : `modules/${module.id}/README.md`,
            mono: true,
          },
          {
            label: 'Replacement plan',
            value: module.required
              ? 'Required module: define replacement before disabling.'
              : 'Disable or maintenance action is available from the module list.',
            tone: module.required ? 'warning' : 'success',
          },
          { label: 'Product area', value: getModuleProductArea(module) },
          { label: 'Last activity', value: module.activity.lastActivityAt ?? 'none' },
          {
            label: 'Release metadata',
            value: module.contractMeta.buildId ?? 'missing',
            tone: module.contractMeta.buildId ? 'success' : 'warning',
          },
          { label: 'Source files', value: String(module.contractMeta.sourceFiles) },
          {
            label: 'Contract digest',
            value: module.contractMeta.contractDigest ?? 'missing',
            mono: true,
          },
        ]}
      />
    </AdminPanel>
  );
}

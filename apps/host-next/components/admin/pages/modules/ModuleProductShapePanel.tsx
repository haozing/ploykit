import { DataTable } from '@host/components/ui';
import { EmptyState } from '@host/components/ProductShell';
import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineColumns } from '@host/lib/admin-inline-i18n';
import { type SupportedLanguage } from '@host/lib/i18n';
import type { AdminModuleDetailView } from '@host/lib/admin-module-operations';
import { joinOrNone, type AdminModuleDetailModule } from './ModuleDetailEvidenceModel';

export function ModuleProductShapePanel({
  lang,
  module,
  copy,
}: {
  lang: SupportedLanguage;
  module: AdminModuleDetailModule;
  copy: ReturnType<typeof import('@host/lib/admin-copy').getAdminModuleDetailCopy>;
}) {
  return (
    <AdminPanel
      title={copy.productShapeTitle}
      description={copy.productShapeDescription}
      contentClassName="grid gap-4"
    >
      {module.product ? (
        <>
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, ['Field', 'Value', 'Evidence'])}
            rows={[
              ['Kind', module.product.kind, 'module.product.kind'],
              ['Audiences', joinOrNone(module.product.audiences), 'module.product.audiences'],
              [
                'Required shells',
                joinOrNone(module.product.requiredShells),
                module.product.missingShells.length > 0
                  ? `missing routes: ${module.product.missingShells.join(', ')}`
                  : 'all required shells have routes',
              ],
              [
                'Navigation',
                module.product.missingNavigationShells.length > 0
                  ? `missing: ${module.product.missingNavigationShells.join(', ')}`
                  : 'all required shell navigation declared',
                'navigation contribution',
              ],
              [
                'Page counts',
                `${module.product.pageCounts.site} site / ${module.product.pageCounts.dashboard} dashboard / ${module.product.pageCounts.admin} admin`,
                `${module.product.pages.length} declared product pages`,
              ],
            ]}
            minWidthClass="min-w-[820px]"
            density="compact"
          />
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, [
              'Shell',
              'Path',
              'Audience',
              'User question',
              'Primary actions',
            ])}
            rows={module.product.pages.map((page) => [
              page.shell,
              page.path,
              page.audience,
              page.userQuestion,
              joinOrNone(page.primaryActions),
            ])}
            minWidthClass="min-w-[980px]"
            density="compact"
          />
        </>
      ) : (
        <EmptyState title={copy.productShapeEmptyTitle}>{copy.productShapeEmptyBody}</EmptyState>
      )}
    </AdminPanel>
  );
}

export type ModuleDetailProductShapeCopy = Pick<
  ReturnType<typeof import('@host/lib/admin-copy').getAdminModuleDetailCopy>,
  'productShapeTitle' | 'productShapeDescription' | 'productShapeEmptyTitle' | 'productShapeEmptyBody'
>;

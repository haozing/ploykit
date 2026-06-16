import { DataTable } from '@host/components/ui';
import { AdminPanel, HealthRowList } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { AdminOperationsViewSnapshot } from '@host/lib/admin-module-operations';
import { moduleProductAreaDetails, type AdminModuleListItem } from './ModulePageModel';

export function ModuleInventoryOverview({
  lang,
  snapshot,
  modules,
  productAreas,
  installedModules,
  enabledModules,
  needsReviewModules,
  requiredModules,
  activeModules,
  mapIssueCount,
}: {
  lang: SupportedLanguage;
  snapshot: AdminOperationsViewSnapshot;
  modules: readonly AdminModuleListItem[];
  productAreas: ReadonlyArray<{ area: string; modules: AdminModuleListItem[] }>;
  installedModules: number;
  enabledModules: number;
  needsReviewModules: number;
  requiredModules: number;
  activeModules: number;
  mapIssueCount: number;
}) {
  const hostSnapshot = snapshot.hostSnapshot;

  return (
    <>
      <AdminPanel
        title={adminInlineText(lang, 'Inventory lanes')}
        description={adminInlineText(
          lang,
          'Module inventory is grouped by product impact before the full capability table.'
        )}
      >
        <HealthRowList
          lang={lang}
          items={[
            {
              key: 'installed',
              title: 'Installed catalog',
              detail: 'Modules with persisted catalog state and discoverable contracts.',
              meta: `${installedModules}/${snapshot.modules.length}`,
              status: installedModules === snapshot.modules.length ? 'complete' : 'partial',
              statusTone: installedModules === snapshot.modules.length ? 'success' : 'warning',
              tone: installedModules === snapshot.modules.length ? 'success' : 'warning',
            },
            {
              key: 'enabled',
              title: 'Enabled surfaces',
              detail: 'Modules currently available to product, dashboard, admin, or API surfaces.',
              meta: `${enabledModules} enabled`,
              status: enabledModules > 0 ? 'active' : 'idle',
              statusTone: enabledModules > 0 ? 'success' : 'neutral',
              tone: enabledModules > 0 ? 'success' : 'neutral',
            },
            {
              key: 'review',
              title: 'Needs review',
              detail: 'Blocked, error, warning, or failed runtime evidence.',
              meta: `${needsReviewModules} modules`,
              status: needsReviewModules > 0 ? 'review' : 'clear',
              statusTone: needsReviewModules > 0 ? 'warning' : 'success',
              tone: needsReviewModules > 0 ? 'warning' : 'success',
              href:
                needsReviewModules > 0
                  ? localizedPath(lang, '/admin/modules?status=blocked')
                  : undefined,
            },
            {
              key: 'required',
              title: 'Required modules',
              detail: 'Core product modules that should not be disabled without replacement.',
              meta: `${requiredModules} required`,
              status: requiredModules > 0 ? 'guarded' : 'none',
              statusTone: requiredModules > 0 ? 'info' : 'neutral',
              tone: 'info',
            },
            {
              key: 'activity',
              title: 'Runtime activity',
              detail: 'Modules with recent runs, outbox, webhook, usage, or file activity.',
              meta: `${activeModules} active`,
              status: activeModules > 0 ? 'active' : 'quiet',
              statusTone: activeModules > 0 ? 'info' : 'neutral',
              tone: activeModules > 0 ? 'info' : 'neutral',
            },
          ]}
        />
      </AdminPanel>

      <AdminPanel
        title={adminInlineText(lang, 'Runtime host snapshot')}
        description={adminInlineText(
          lang,
          'Mounted capabilities, provider profile, route resolution, and module-map release evidence are captured from the same runtime host.'
        )}
      >
        <DataTable
          className="shadow-none"
          density="compact"
          columns={adminInlineColumns(lang, ['Snapshot', 'Value', 'Evidence'])}
          rows={[
            [
              'Mounted capabilities',
              `${hostSnapshot.mountedCapabilities.modules} modules / ${hostSnapshot.mountedCapabilities.routes} routes / ${hostSnapshot.mountedCapabilities.actions} actions`,
              `${hostSnapshot.mountedCapabilities.surfaces} surfaces / ${hostSnapshot.mountedCapabilities.dataModels} data models`,
            ],
            [
              'Provider profile',
              `${hostSnapshot.providerProfile.services.length} services / ${hostSnapshot.providerProfile.resourceBindings.length} resources`,
              hostSnapshot.providerProfile.egressOrigins.length > 0
                ? hostSnapshot.providerProfile.egressOrigins.join(', ')
                : 'no external egress',
            ],
            [
              'Product scope',
              hostSnapshot.productScope?.productId ?? 'unknown',
              `${hostSnapshot.productScope?.workspaceId ?? 'no workspace'} / ${hostSnapshot.productScope?.profile ?? 'default'}`,
            ],
            [
              'Module map',
              snapshot.moduleMapHealth.ok ? 'clean' : `${mapIssueCount} issue(s)`,
              `${hostSnapshot.moduleMapHealth.entriesWithReleaseMetadata}/${hostSnapshot.moduleMapHealth.modules} entries with release metadata`,
            ],
          ]}
          minWidthClass="min-w-[780px]"
        />
      </AdminPanel>

      <AdminPanel
        title={adminInlineText(lang, 'Product area map')}
        description={adminInlineText(
          lang,
          'Modules are grouped by the product area they shape before raw catalog rows.'
        )}
      >
        <HealthRowList
          lang={lang}
          items={productAreas.map(({ area, modules: areaModules }) => {
            const reviewCount = areaModules.filter(
              (module) =>
                module.runtimeState === 'blocked' ||
                module.runtimeState === 'error' ||
                module.health.errors > 0 ||
                module.health.warnings > 0
            ).length;
            const enabledCount = areaModules.filter((module) => module.status === 'enabled').length;
            return {
              key: area,
              title: area,
              detail: `${adminInlineText(lang, moduleProductAreaDetails[area] ?? moduleProductAreaDetails.Platform)} ${areaModules
                .map((module) => module.name)
                .slice(0, 3)
                .join(', ')}`,
              meta: `${enabledCount}/${areaModules.length} enabled`,
              status: reviewCount > 0 ? 'review' : 'clear',
              statusTone: reviewCount > 0 ? ('warning' as const) : ('success' as const),
              tone: reviewCount > 0 ? ('warning' as const) : ('success' as const),
              href: areaModules[0]
                ? localizedPath(lang, `/admin/modules?q=${encodeURIComponent(areaModules[0].id)}`)
                : undefined,
            };
          })}
        />
      </AdminPanel>
    </>
  );
}

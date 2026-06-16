import type { ReactNode } from 'react';
import { Box, CircleCheck, FileCode2, PackageCheck, ShieldAlert } from 'lucide-react';
import { adminNav, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { HostPageSlot } from '@host/components/layout/HostPageSlot';
import { ActionQueue, StatGrid } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminModulesCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { AdminOperationsViewSnapshot } from '@host/lib/admin-module-operations';
import { ModuleCatalogSection } from './ModuleCatalogSection';
import { ModuleInventoryOverview } from './ModuleInventoryOverview';
import {
  getModuleProductArea,
  type AdminModuleListItem,
} from './ModulePageModel';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

function cleanTableQuery(query?: AdminTableQuery): Required<AdminTableQuery> {
  return {
    q: query?.q?.trim() ?? '',
    status: query?.status?.trim() ?? '',
    role: query?.role?.trim() ?? '',
    type: query?.type?.trim() ?? '',
    moduleId: query?.moduleId?.trim() ?? '',
    service: query?.service?.trim() ?? '',
    workspace: query?.workspace?.trim() ?? '',
    environment: query?.environment?.trim() ?? '',
    range: query?.range?.trim() ?? '',
    from: query?.from?.trim() ?? '',
    to: query?.to?.trim() ?? '',
    owner: query?.owner?.trim() ?? '',
    mime: query?.mime?.trim() ?? '',
    provider: query?.provider?.trim() ?? '',
    path: query?.path?.trim() ?? '',
    minSize: query?.minSize ?? 0,
    maxSize: query?.maxSize ?? 0,
    page: query?.page ?? 1,
    pageSize: query?.pageSize ?? 20,
    operation: query?.operation?.trim() ?? '',
    outcome: query?.outcome?.trim() ?? '',
    matched: query?.matched ?? 0,
    processed: query?.processed ?? 0,
    failed: query?.failed ?? 0,
    skipped: query?.skipped ?? 0,
    deadLettered: query?.deadLettered ?? 0,
  };
}

function matchesTextSearch(query: string, values: readonly unknown[]): boolean {
  if (query.length === 0) {
    return true;
  }
  const needle = query.toLowerCase();
  return values.some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(needle)
  );
}

function matchesExactFilter(filter: string, value: unknown): boolean {
  return filter.length === 0 || String(value ?? '') === filter;
}

export function AdminModulesOperationsPage({
  lang,
  snapshot,
  updateModuleStatusAction,
  query,
  headerActions,
}: {
  lang: SupportedLanguage;
  snapshot: AdminOperationsViewSnapshot;
  updateModuleStatusAction: AdminFormAction;
  query?: AdminTableQuery;
  headerActions?: ReactNode;
}) {
  const copy = getAdminModulesCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const modules = snapshot.modules.filter((module) => {
    const searchable = [
      module.id,
      module.name,
      module.version,
      module.status,
      module.runtimeState,
      module.health.status,
      module.permissions.join(' '),
    ];
    return (
      matchesTextSearch(tableQuery.q, searchable) &&
      (matchesExactFilter(tableQuery.status, module.status) ||
        matchesExactFilter(tableQuery.status, module.runtimeState) ||
        matchesExactFilter(tableQuery.status, module.health.status))
    );
  });
  const enabledModules = snapshot.modules.filter((module) => module.status === 'enabled').length;
  const blockedModules = snapshot.modules.filter(
    (module) => module.runtimeState === 'blocked'
  ).length;
  const modulesWithErrors = snapshot.modules.filter(
    (module) => module.runtimeState === 'error' || module.health.errors > 0
  ).length;
  const installedModules = snapshot.modules.filter((module) => module.installed).length;
  const needsReviewModules = modules.filter(
    (module) =>
      module.runtimeState === 'blocked' ||
      module.runtimeState === 'error' ||
      module.health.errors > 0 ||
      module.health.warnings > 0
  ).length;
  const requiredModules = modules.filter((module) => module.required).length;
  const activeModules = modules.filter(
    (module) => module.activity.runs > 0 || module.activity.outbox > 0
  ).length;
  const mapIssueCount = snapshot.moduleMapHealth.issues.length;
  const productAreas = modules.reduce<Array<{ area: string; modules: AdminModuleListItem[] }>>(
    (acc, module) => {
      const area = getModuleProductArea(module);
      const existing = acc.find((item) => item.area === area);
      if (existing) {
        existing.modules.push(module);
      } else {
        acc.push({ area, modules: [module] });
      }
      return acc;
    },
    []
  );
  const reviewItems = [
    blockedModules > 0
      ? {
          key: 'blocked-modules',
          title: 'Blocked module runtime',
          description: `${blockedModules} modules are blocked at runtime. Review lifecycle state, required resources, and diagnostics before enabling traffic.`,
          actionLabel: 'Review blocked',
          href: localizedPath(lang, '/admin/modules?status=blocked'),
          status: 'blocked',
          tone: 'danger' as const,
        }
      : null,
    modulesWithErrors > 0
      ? {
          key: 'module-errors',
          title: 'Module health errors',
          description: `${modulesWithErrors} modules report runtime errors or doctor failures. Inspect module detail before release candidate checks.`,
          actionLabel: 'Review errors',
          href: localizedPath(lang, '/admin/modules?status=error'),
          status: 'failed',
          tone: 'danger' as const,
        }
      : null,
    mapIssueCount > 0
      ? {
          key: 'module-map-drift',
          title: 'Module map drift',
          description: `${mapIssueCount} map/contract consistency issue(s) were found. Regenerate the module map before relying on release evidence.`,
          actionLabel: 'Open dev console',
          href: localizedPath(lang, '/admin/module-dev-console'),
          status: 'drift',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <WorkspaceShell
      lang={lang}
      title={copy.title}
      subtitle={copy.subtitle}
      nav={adminNav}
      actions={
        headerActions ? <HostPageSlot slotId="header.actions">{headerActions}</HostPageSlot> : null
      }
    >
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Installed')}
          value={`${installedModules}/${snapshot.modules.length}`}
          helper={adminInlineText(lang, 'Catalog states persisted')}
          tone="blue"
          icon={PackageCheck}
        />
        <StatCard
          label={adminInlineText(lang, 'Enabled')}
          value={String(enabledModules)}
          helper={adminInlineText(lang, 'Available to product surfaces')}
          tone="green"
          icon={CircleCheck}
        />
        <StatCard
          label={adminInlineText(lang, 'Blocked')}
          value={String(blockedModules)}
          helper={adminInlineText(lang, 'Runtime prevents execution')}
          tone={blockedModules > 0 ? 'amber' : 'neutral'}
          icon={ShieldAlert}
        />
        <StatCard
          label={adminInlineText(lang, 'Health Errors')}
          value={String(modulesWithErrors)}
          helper={adminInlineText(lang, 'Doctor or runtime failures')}
          tone={modulesWithErrors > 0 ? 'red' : 'neutral'}
          icon={Box}
        />
        <StatCard
          label={adminInlineText(lang, 'Map Health')}
          value={snapshot.moduleMapHealth.ok ? 'clean' : String(mapIssueCount)}
          helper={`Build ${snapshot.moduleMapHealth.buildId ?? 'local'}`}
          tone={snapshot.moduleMapHealth.ok ? 'green' : 'amber'}
          icon={FileCode2}
        />
      </StatGrid>

      {reviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'Module review')}
          description={adminInlineText(
            lang,
            'Only lifecycle and health states that need action appear here. Capability evidence stays in module detail.'
          )}
          status="warning"
          items={reviewItems}
        />
      ) : null}

      <ModuleInventoryOverview
        lang={lang}
        snapshot={snapshot}
        modules={modules}
        productAreas={productAreas}
        installedModules={installedModules}
        enabledModules={enabledModules}
        needsReviewModules={needsReviewModules}
        requiredModules={requiredModules}
        activeModules={activeModules}
        mapIssueCount={mapIssueCount}
      />

      <ModuleCatalogSection
        lang={lang}
        tableQuery={tableQuery}
        modules={modules}
        totalModules={snapshot.modules.length}
        needsReviewModules={needsReviewModules}
        requiredModules={requiredModules}
        activeModules={activeModules}
        updateModuleStatusAction={updateModuleStatusAction}
      />
    </WorkspaceShell>
  );
}

export { AdminModuleDetailOperationsPage } from './ModuleDetailPage';

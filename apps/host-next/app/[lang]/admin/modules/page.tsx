import type { ModuleCatalogModuleStatus } from '@/lib/module-runtime';
import { AdminModulesOperationsPage } from '@host/components/admin/AdminPages';
import { getAdminOperationsView, setAdminModuleStatus } from '@host/lib/admin-module-operations';
import { renderHostPageSlotById } from '@host/lib/host-page-rendering';
import { localizedPath } from '@host/lib/i18n';
import { createAdminAction } from '@host/lib/admin-action';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ADMIN_FORM_FIELD_REQUIRED: ${name}`);
  }
  return value;
}

function readModuleStatus(formData: FormData): ModuleCatalogModuleStatus {
  const status = readRequiredFormString(formData, 'status');
  if (status === 'enabled' || status === 'disabled' || status === 'maintenance') {
    return status;
  }
  throw new Error(`ADMIN_MODULE_STATUS_UNSUPPORTED: ${status}`);
}

const updateModuleStatusAction = createAdminAction({
  id: 'modules.status',
  parse: (formData) => ({
    moduleId: readRequiredFormString(formData, 'moduleId'),
    status: readModuleStatus(formData),
    reason: formData.get('reason')?.toString(),
  }),
  run: ({ session, input }) => setAdminModuleStatus(session, input.moduleId, input.status, input.reason),
  revalidate: ({ input }) => ['/admin/modules', `/admin/modules/${input.moduleId}`, '/admin'],
  audit: {
    metadata: ({ input }) => ({
      moduleId: input.moduleId,
      status: input.status,
      reason: input.reason,
    }),
  },
});

export default async function AdminModulesPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang, session] = await readLanguageAndRequireAdmin(params, '/admin/modules');
  const query = await readAdminTableQuery(searchParams);
  const [view, headerActions] = await Promise.all([
    getAdminOperationsView(),
    renderHostPageSlotById({
      pageId: 'admin.modules',
      slotId: 'header.actions',
      pathname: localizedPath(lang, '/admin/modules'),
      session,
    }),
  ]);
  return (
    <AdminModulesOperationsPage
      lang={lang}
      snapshot={view.snapshot}
      updateModuleStatusAction={updateModuleStatusAction}
      query={query}
      headerActions={headerActions.length > 0 ? headerActions : null}
    />
  );
}

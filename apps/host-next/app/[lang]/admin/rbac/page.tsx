import { AdminRbacOperationsPage } from '@host/components/admin/AdminPages';
import { listAdminPermissions, listAdminRoles } from '@host/lib/admin-api';
import { getHostIdentityOperationsView } from '@host/lib/identity-operations';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

export default async function AdminRbacPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang] = await readLanguageAndRequireAdmin(params, '/admin/rbac');
  const [query, identity] = await Promise.all([
    readAdminTableQuery(searchParams),
    getHostIdentityOperationsView(),
  ]);
  return (
    <AdminRbacOperationsPage
      lang={lang}
      roles={listAdminRoles()}
      permissions={listAdminPermissions()}
      users={identity.users}
      query={query}
    />
  );
}

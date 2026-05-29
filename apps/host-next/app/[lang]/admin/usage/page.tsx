import { AdminUsageOperationsPage } from '@host/components/admin/AdminPages';
import { listAdminMetering, listAdminUsage } from '@host/lib/admin-api';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

export default async function AdminUsagePage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang] = await readLanguageAndRequireAdmin(params, '/admin/usage');
  const query = await readAdminTableQuery(searchParams);
  return (
    <AdminUsageOperationsPage
      lang={lang}
      usage={await listAdminUsage({ q: query.q })}
      metering={await listAdminMetering({ q: query.q, status: query.status })}
      query={query}
    />
  );
}

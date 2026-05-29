import { AdminSearchOperationsPage } from '@host/components/admin/AdminPages';
import { searchAdmin } from '@host/lib/admin-api';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

export default async function AdminSearchPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang, session] = await readLanguageAndRequireAdmin(params, '/admin/search');
  const query = await readAdminTableQuery(searchParams);
  const pageSize = query.pageSize ?? 20;
  const page = query.page ?? 1;
  const searchQuery = {
    q: query.q,
    type: query.type,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
  return (
    <AdminSearchOperationsPage
      lang={lang}
      results={await searchAdmin(searchQuery, { session })}
      query={query}
    />
  );
}

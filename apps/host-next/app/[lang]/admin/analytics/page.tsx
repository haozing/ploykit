import { AdminAnalyticsOperationsPage } from '@host/components/admin/AdminPages';
import { getAdminAnalytics } from '@host/lib/admin-api';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

export default async function AdminAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang] = await readLanguageAndRequireAdmin(params, '/admin/analytics');
  const query = await readAdminTableQuery(searchParams);
  return (
    <AdminAnalyticsOperationsPage
      lang={lang}
      analytics={await getAdminAnalytics({ range: query.range, from: query.from, to: query.to })}
      query={query}
    />
  );
}

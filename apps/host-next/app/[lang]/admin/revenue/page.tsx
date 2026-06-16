import { AdminRevenueOperationsPage } from '@host/components/admin/AdminPages';
import { getAdminRevenue } from '@host/lib/admin-api';
import { createAdminAction } from '@host/lib/admin-action';
import { getAdminCommercialView } from '@host/lib/admin-commercial';
import { reconcileHostBillingPaidOrderBenefits } from '@host/lib/commercial-provider';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

const reconcileBillingAction = createAdminAction({
  id: 'revenue.reconcile',
  run: async ({ session }) => reconcileHostBillingPaidOrderBenefits(session),
  revalidate: () => ['/admin/revenue', '/admin/billing', '/dashboard/billing'],
});

export default async function AdminRevenuePage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang] = await readLanguageAndRequireAdmin(params, '/admin/revenue');
  const query = await readAdminTableQuery(searchParams);
  const [revenue, commercial] = await Promise.all([
    getAdminRevenue({ q: query.q, status: query.status }),
    getAdminCommercialView(),
  ]);
  return (
    <AdminRevenueOperationsPage
      lang={lang}
      revenue={revenue}
      commercial={commercial}
      reconcileBillingAction={reconcileBillingAction}
      query={query}
    />
  );
}

import { AdminOverviewPage } from '@host/components/admin/AdminPages';
import { getAdminOperationsView } from '@host/lib/admin-module-operations';
import { getHostIdentityOperationsView } from '@host/lib/identity-operations';
import { listAdminRoles } from '@host/lib/admin-api';
import { getAdminProviderStatusView } from '@host/lib/admin-provider-status';
import { getAdminWorkerStatusView } from '@host/lib/admin-worker-status';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';

export default async function AdminPage({ params }: { params: Promise<LanguageRouteParams> }) {
  const [lang] = await readLanguageAndRequireAdmin(params, '/admin');
  const [view, identity, providerStatus, workerStatus] = await Promise.all([
    getAdminOperationsView(),
    getHostIdentityOperationsView(),
    getAdminProviderStatusView(),
    getAdminWorkerStatusView(),
  ]);
  return (
    <AdminOverviewPage
      lang={lang}
      snapshot={view.snapshot}
      store={view.store}
      users={identity.users}
      roles={listAdminRoles()}
      providerStatus={providerStatus}
      workerStatus={workerStatus}
    />
  );
}

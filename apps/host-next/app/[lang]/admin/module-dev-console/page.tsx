import { AdminModuleDevConsoleOperationsPage } from '@host/components/admin/AdminPages';
import { HostPagesPanel } from '@host/components/dev-console/HostPagesPanel';
import { getAdminModuleDevConsoleView } from '@host/lib/admin-module-dev-console';
import {
  getProductCompositionView,
  getProductThemeDiagnosticsView,
} from '@host/lib/product-composition';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';

export default async function AdminModuleDevConsolePage({
  params,
}: {
  params: Promise<LanguageRouteParams>;
}) {
  const [lang] = await readLanguageAndRequireAdmin(params, '/admin/module-dev-console');
  const [view, composition, theme] = await Promise.all([
    getAdminModuleDevConsoleView(),
    getProductCompositionView(),
    getProductThemeDiagnosticsView(),
  ]);
  return (
    <AdminModuleDevConsoleOperationsPage
      lang={lang}
      view={view}
      composition={composition}
      theme={theme}
      diagnosticsPanel={<HostPagesPanel composition={composition} theme={theme} />}
    />
  );
}

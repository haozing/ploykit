import { AdminModuleDetailOperationsPage } from '@host/components/admin/AdminPages';
import { getAdminModuleDetail } from '@host/lib/admin-module-operations';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';

interface AdminModuleDetailRouteParams extends LanguageRouteParams {
  moduleId: string;
}

export default async function AdminModuleDetailPage({
  params,
}: {
  params: Promise<AdminModuleDetailRouteParams>;
}) {
  const resolved = await params;
  const [lang] = await readLanguageAndRequireAdmin(
    Promise.resolve(resolved),
    `/admin/modules/${resolved.moduleId}`
  );
  const detail = await getAdminModuleDetail(resolved.moduleId);
  return <AdminModuleDetailOperationsPage lang={lang} detail={detail} />;
}

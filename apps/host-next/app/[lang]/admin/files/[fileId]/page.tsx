import { AdminFileDetailOperationsPage } from '@host/components/admin/AdminPages';
import { getAdminFileDetailView } from '@host/lib/admin-operations';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';

interface AdminFileDetailParams extends LanguageRouteParams {
  fileId: string;
}

export default async function AdminFileDetailPage({
  params,
}: {
  params: Promise<AdminFileDetailParams>;
}) {
  const resolved = await params;
  const [lang] = await readLanguageAndRequireAdmin(Promise.resolve(resolved), '/admin/files');
  return (
    <AdminFileDetailOperationsPage
      lang={lang}
      detail={await getAdminFileDetailView(resolved.fileId)}
    />
  );
}

import { DashboardFilesOperationsPage } from '@host/components/files/FilePages';
import { generatePresentedHostMetadata } from '@host/lib/host-page-rendering';
import { renderPresentedHostPage } from '@host/lib/host-page-rendering';
import { getHostFileQuotaStatus, getHostFileStorageStatus, listHostUserFiles } from '@host/lib/files';
import {
  readLanguageAndRequireUser,
  readLanguageParam,
  type LanguageRouteParams,
} from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';
import type { RuntimeStoreFileRecord } from '@/lib/module-runtime';

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang, session] = await readLanguageAndRequireUser(params, '/dashboard/files');
  const query = await readAdminTableQuery(searchParams);
  const [files, storage, quota] = await Promise.all([
    listHostUserFiles(session, {
      q: query.q,
      status: query.status as RuntimeStoreFileRecord['status'] | undefined,
    }),
    getHostFileStorageStatus(),
    getHostFileQuotaStatus(session),
  ]);
  return renderPresentedHostPage({
    pageId: 'dashboard.files',
    defaultPage: (
      <DashboardFilesOperationsPage
        lang={lang}
        files={files}
        storage={storage}
        quota={quota}
        query={query}
      />
    ),
    lang,
    session,
    workspaceId: session.workspaceId,
  });
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({ pageId: 'dashboard.files', lang });
}

import { AdminRunsOperationsPage } from '@host/components/admin/AdminPages';
import { getAdminOperationsView } from '@host/lib/admin-module-operations';
import { renderHostPageSlotById } from '@host/lib/host-page-rendering';
import { localizedPath } from '@host/lib/i18n';
import {
  cancelAdminRunAction as cancelRunAction,
  requeueAdminRunAction as requeueRunAction,
} from '@host/lib/admin-run-actions';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

export default async function AdminRunsPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang, session] = await readLanguageAndRequireAdmin(params, '/admin/runs');
  const query = await readAdminTableQuery(searchParams);
  const [view, headerActions, mainBefore, mainAfter] = await Promise.all([
    getAdminOperationsView(),
    renderHostPageSlotById({
      pageId: 'admin.runs',
      slotId: 'header.actions',
      pathname: localizedPath(lang, '/admin/runs'),
      session,
    }),
    renderHostPageSlotById({
      pageId: 'admin.runs',
      slotId: 'main.before',
      pathname: localizedPath(lang, '/admin/runs'),
      session,
    }),
    renderHostPageSlotById({
      pageId: 'admin.runs',
      slotId: 'main.after',
      pathname: localizedPath(lang, '/admin/runs'),
      session,
    }),
  ]);
  return (
    <AdminRunsOperationsPage
      lang={lang}
      snapshot={view.snapshot}
      requeueRunAction={requeueRunAction}
      cancelRunAction={cancelRunAction}
      query={query}
      headerActions={headerActions.length > 0 ? headerActions : null}
      mainBefore={mainBefore.length > 0 ? mainBefore : null}
      mainAfter={mainAfter.length > 0 ? mainAfter : null}
    />
  );
}

import { DashboardTaskDetailOperationsPage } from '@host/components/dashboard/DashboardPages';
import { generatePresentedHostMetadata, renderPresentedHostPage } from '@host/lib/host-page-rendering';
import {
  readLanguageAndRequireUser,
  readLanguageParam,
  type LanguageRouteParams,
} from '@host/lib/route-params';
import { getUserTaskDetail } from '@host/lib/saas-operations';

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<LanguageRouteParams & { id: string }>;
}) {
  const routeParams = await params;
  const [lang, session] = await readLanguageAndRequireUser(
    Promise.resolve(routeParams),
    `/dashboard/tasks/${routeParams.id}`
  );
  const run = await getUserTaskDetail(session, routeParams.id);
  const pathname = `/${lang}/dashboard/tasks/${routeParams.id}`;
  return renderPresentedHostPage({
    pageId: 'dashboard.task-detail',
    defaultPage: <DashboardTaskDetailOperationsPage lang={lang} run={run} />,
    lang,
    session,
    workspaceId: session.workspaceId,
    pathname,
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<LanguageRouteParams & { id: string }>;
}) {
  const routeParams = await params;
  const lang = await readLanguageParam(Promise.resolve(routeParams));
  return generatePresentedHostMetadata({
    pageId: 'dashboard.task-detail',
    lang,
    pathname: `/${lang}/dashboard/tasks/${routeParams.id}`,
  });
}

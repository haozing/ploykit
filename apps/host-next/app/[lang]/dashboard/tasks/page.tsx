import { DashboardTasksOperationsPage } from '@host/components/dashboard/DashboardPages';
import { generatePresentedHostMetadata } from '@host/lib/host-page-rendering';
import { renderPresentedHostPage } from '@host/lib/host-page-rendering';
import {
  readLanguageAndRequireUser,
  readLanguageParam,
  type LanguageRouteParams,
} from '@host/lib/route-params';
import { getUserSaasSnapshot } from '@host/lib/saas-operations';

export default async function TasksPage({ params }: { params: Promise<LanguageRouteParams> }) {
  const [lang, session] = await readLanguageAndRequireUser(params, '/dashboard/tasks');
  const snapshot = await getUserSaasSnapshot(session);
  return renderPresentedHostPage({
    pageId: 'dashboard.tasks',
    defaultPage: <DashboardTasksOperationsPage lang={lang} snapshot={snapshot} />,
    lang,
    session,
    workspaceId: session.workspaceId,
  });
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({ pageId: 'dashboard.tasks', lang });
}

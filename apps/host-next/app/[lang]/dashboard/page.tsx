import { DashboardLandingPage } from '@host/components/dashboard/DashboardPages';
import { generatePresentedHostMetadata } from '@host/lib/host-page-rendering';
import { renderPresentedHostPage } from '@host/lib/host-page-rendering';
import { getUserSaasSnapshot } from '@host/lib/saas-operations';
import { getHostUserProfile } from '@host/lib/user-api';
import {
  readLanguageAndRequireUser,
  readLanguageParam,
  type LanguageRouteParams,
} from '@host/lib/route-params';

export default async function DashboardPage({ params }: { params: Promise<LanguageRouteParams> }) {
  const [lang, session] = await readLanguageAndRequireUser(params, '/dashboard');
  const [snapshot, profile] = await Promise.all([
    getUserSaasSnapshot(session),
    getHostUserProfile(session),
  ]);
  return renderPresentedHostPage({
    pageId: 'dashboard.home',
    defaultPage: <DashboardLandingPage lang={lang} snapshot={snapshot} profile={profile} />,
    componentProps: {
      userEmail: profile.email,
    },
    lang,
    session,
    workspaceId: session.workspaceId,
  });
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({ pageId: 'dashboard.home', lang });
}

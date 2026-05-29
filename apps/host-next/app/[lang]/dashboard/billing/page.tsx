import { DashboardBillingOperationsPage } from '@host/components/billing/BillingPages';
import { generatePresentedHostMetadata } from '@host/lib/host-page-rendering';
import { renderPresentedHostPage } from '@host/lib/host-page-rendering';
import { getHostBillingOverview } from '@host/lib/billing-api';
import {
  readLanguageAndRequireUser,
  readLanguageParam,
  type LanguageRouteParams,
} from '@host/lib/route-params';

export default async function BillingPage({ params }: { params: Promise<LanguageRouteParams> }) {
  const [lang, session] = await readLanguageAndRequireUser(params, '/dashboard/billing');
  return renderPresentedHostPage({
    pageId: 'dashboard.billing',
    defaultPage: (
      <DashboardBillingOperationsPage
        lang={lang}
        overview={await getHostBillingOverview(session)}
      />
    ),
    lang,
    session,
    workspaceId: session.workspaceId,
  });
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({ pageId: 'dashboard.billing', lang });
}

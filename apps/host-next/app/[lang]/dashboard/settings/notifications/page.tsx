import { DashboardNotificationSettingsOperationsPage } from '@host/components/notifications/NotificationPages';
import { generatePresentedHostMetadata } from '@host/lib/host-page-rendering';
import { renderPresentedHostPage } from '@host/lib/host-page-rendering';
import {
  getHostNotificationPreferences,
  updateHostNotificationPreferences,
} from '@host/lib/notifications-api';
import { requireUserActionContext, revalidateLocalizedPaths } from '@host/lib/request-context';
import {
  readLanguageAndRequireUser,
  readLanguageParam,
  type LanguageRouteParams,
} from '@host/lib/route-params';

async function updatePreferencesAction(formData: FormData) {
  'use server';

  const { lang, session } = await requireUserActionContext('/dashboard/settings/notifications');
  await updateHostNotificationPreferences(session, {
    inApp: formData.has('inApp'),
    email: formData.has('email'),
    billing: formData.has('billing'),
    files: formData.has('files'),
    admin: formData.has('admin'),
  });
  revalidateLocalizedPaths(lang, ['/dashboard/settings/notifications', '/dashboard/notifications']);
}

export default async function NotificationSettingsPage({
  params,
}: {
  params: Promise<LanguageRouteParams>;
}) {
  const [lang, session] = await readLanguageAndRequireUser(params, '/dashboard/settings/notifications');
  const preferences = await getHostNotificationPreferences(session);
  return renderPresentedHostPage({
    pageId: 'dashboard.notification-settings',
    defaultPage: (
      <DashboardNotificationSettingsOperationsPage
        lang={lang}
        preferences={preferences}
        updatePreferencesAction={updatePreferencesAction}
      />
    ),
    lang,
    session,
    workspaceId: session.workspaceId,
  });
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({
    pageId: 'dashboard.notification-settings',
    lang,
  });
}

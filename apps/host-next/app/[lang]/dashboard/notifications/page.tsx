import { DashboardNotificationsOperationsPage } from '@host/components/notifications/NotificationPages';
import { generatePresentedHostMetadata } from '@host/lib/host-page-rendering';
import { renderPresentedHostPage } from '@host/lib/host-page-rendering';
import {
  readLanguageAndRequireUser,
  readLanguageParam,
  type LanguageRouteParams,
} from '@host/lib/route-params';
import {
  listHostNotifications,
  markHostNotificationRead,
  markHostNotificationsRead,
} from '@host/lib/notifications-api';
import { requireUserActionContext, revalidateLocalizedPaths } from '@host/lib/request-context';

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`DASHBOARD_FORM_FIELD_REQUIRED: ${name}`);
  }
  return value;
}

async function markNotificationReadAction(formData: FormData) {
  'use server';

  const { lang, session } = await requireUserActionContext('/dashboard/notifications');
  await markHostNotificationRead(session, readRequiredFormString(formData, 'notificationId'));
  revalidateLocalizedPaths(lang, ['/dashboard/notifications']);
}

async function markAllNotificationsReadAction() {
  'use server';

  const { lang, session } = await requireUserActionContext('/dashboard/notifications');
  await markHostNotificationsRead(session);
  revalidateLocalizedPaths(lang, ['/dashboard/notifications']);
}

export default async function NotificationsPage({
  params,
}: {
  params: Promise<LanguageRouteParams>;
}) {
  const [lang, session] = await readLanguageAndRequireUser(params, '/dashboard/notifications');
  const notifications = await listHostNotifications(session);
  return renderPresentedHostPage({
    pageId: 'dashboard.notifications',
    defaultPage: (
      <DashboardNotificationsOperationsPage
        lang={lang}
        notifications={notifications}
        markNotificationReadAction={markNotificationReadAction}
        markAllNotificationsReadAction={markAllNotificationsReadAction}
      />
    ),
    lang,
    session,
    workspaceId: session.workspaceId,
  });
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({ pageId: 'dashboard.notifications', lang });
}

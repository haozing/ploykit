import { DashboardProfileOperationsPage } from '@host/components/dashboard/DashboardPages';
import { generatePresentedHostMetadata } from '@host/lib/host-page-rendering';
import { renderPresentedHostPage } from '@host/lib/host-page-rendering';
import { getHostAuthAdapter } from '@host/lib/auth';
import { requireUserActionContext, revalidateLocalizedPaths } from '@host/lib/request-context';
import {
  readLanguageAndRequireUser,
  readLanguageParam,
  type LanguageRouteParams,
} from '@host/lib/route-params';
import {
  changeHostUserPassword,
  getHostUserProfile,
  updateHostUserPreferences,
  updateHostUserProfile,
} from '@host/lib/user-api';

function readFormString(formData: FormData, name: string, fallback = ''): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : fallback;
}

async function updateProfileAction(formData: FormData) {
  'use server';

  const { lang, session } = await requireUserActionContext('/dashboard/profile');
  await updateHostUserProfile(session, {
    displayName: readFormString(formData, 'displayName'),
    avatarUrl: readFormString(formData, 'avatarUrl'),
    language: readFormString(formData, 'language', 'zh'),
    timezone: readFormString(formData, 'timezone', 'Asia/Hong_Kong'),
  });
  revalidateLocalizedPaths(lang, [
    '/dashboard',
    '/dashboard/profile',
    '/dashboard/settings/notifications',
    '/dashboard/notifications',
  ]);
}

async function updateNotificationPreferencesAction(formData: FormData) {
  'use server';

  const { lang, session } = await requireUserActionContext('/dashboard/profile');
  await updateHostUserPreferences(session, {
    inApp: formData.has('inApp'),
    email: formData.has('email'),
    billing: formData.has('billing'),
    files: formData.has('files'),
    admin: formData.has('admin'),
  });
  revalidateLocalizedPaths(lang, [
    '/dashboard',
    '/dashboard/profile',
    '/dashboard/settings/notifications',
    '/dashboard/notifications',
  ]);
}

async function changePasswordAction(formData: FormData) {
  'use server';

  const { lang, session } = await requireUserActionContext('/dashboard/profile');
  await changeHostUserPassword(session, {
    currentPassword: readFormString(formData, 'currentPassword'),
    newPassword: readFormString(formData, 'newPassword'),
  });
  revalidateLocalizedPaths(lang, [
    '/dashboard',
    '/dashboard/profile',
    '/dashboard/settings/notifications',
    '/dashboard/notifications',
  ]);
}

async function revokeSessionAction(formData: FormData) {
  'use server';

  const { lang, session } = await requireUserActionContext('/dashboard/profile');
  const sessionId = readFormString(formData, 'sessionId');
  if (session.userId && sessionId) {
    await (await getHostAuthAdapter()).revokeSession(session.userId, sessionId);
  }
  revalidateLocalizedPaths(lang, [
    '/dashboard',
    '/dashboard/profile',
    '/dashboard/settings/notifications',
    '/dashboard/notifications',
  ]);
}

export default async function ProfilePage({ params }: { params: Promise<LanguageRouteParams> }) {
  const [lang, session] = await readLanguageAndRequireUser(params, '/dashboard/profile');
  const [profile, sessions] = await Promise.all([
    getHostUserProfile(session),
    (await getHostAuthAdapter()).listSessions(session.userId ?? ''),
  ]);
  return renderPresentedHostPage({
    pageId: 'dashboard.profile',
    defaultPage: (
      <DashboardProfileOperationsPage
        lang={lang}
        profile={profile}
        sessions={sessions}
        updateProfileAction={updateProfileAction}
        updateNotificationPreferencesAction={updateNotificationPreferencesAction}
        changePasswordAction={changePasswordAction}
        revokeSessionAction={revokeSessionAction}
      />
    ),
    lang,
    session,
    workspaceId: session.workspaceId,
  });
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({ pageId: 'dashboard.profile', lang });
}

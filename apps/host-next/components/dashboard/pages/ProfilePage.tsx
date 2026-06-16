import { WorkspaceShell } from '@host/components/ProductShell';
import { ConfirmSubmitButton, Input, Select, Switch } from '@host/components/ui';
import {
  AdminPanel,
  FactList,
  PageSynopsis,
  TimelineList,
} from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import type { HostAuthSessionRecord } from '@host/lib/auth';
import type { HostUserProfile } from '@host/lib/user-api';
import {
  UserSectionNav,
  dashboardGhostButtonClass,
  dashboardPrimaryButtonClass,
  formatUserDate,
  formatUserLanguage,
  formatUserRole,
  formatWorkspaceLabel,
} from './DashboardPageUtils';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

function DashboardProfileOperationsPageV2({
  lang,
  profile,
  sessions,
  updateProfileAction,
  updateNotificationPreferencesAction,
  changePasswordAction,
  revokeSessionAction,
}: {
  lang: SupportedLanguage;
  profile: HostUserProfile;
  sessions: HostAuthSessionRecord[];
  updateProfileAction: AdminFormAction;
  updateNotificationPreferencesAction: AdminFormAction;
  changePasswordAction: AdminFormAction;
  revokeSessionAction: AdminFormAction;
}) {
  const copy = getDashboardCopy(lang).profile;
  const notifications = profile.preferences.notifications;
  const initials =
    (profile.displayName ?? profile.email)
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'U';

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <div className="grid gap-4">
        <PageSynopsis
          lang={lang}
          title={profile.displayName ?? profile.email}
          description={dashboardInlineText(
            lang,
            'manage_your_profile_account_security_and_notific_70656c74'
          )}
          status={profile.status}
          statusTone={profile.status === 'active' ? 'success' : 'warning'}
          items={[
            {
              key: 'role',
              label: dashboardInlineText(lang, 'account_role_e58f704e'),
              value: formatUserRole(lang, profile.role),
              tone: profile.role === 'admin' ? 'warning' : 'primary',
            },
            {
              key: 'workspace-role',
              label: dashboardInlineText(lang, 'team_role_99090a66'),
              value: formatUserRole(lang, profile.workspaceRole),
            },
            {
              key: 'sessions',
              label: dashboardInlineText(lang, 'other_devices_c12cc6e3'),
              value: String(sessions.length),
              tone: sessions.length > 1 ? 'warning' : 'neutral',
            },
            {
              key: 'language',
              label: copy.language,
              value: formatUserLanguage(lang, profile.language ?? lang),
            },
          ]}
        />

        <UserSectionNav
          items={[
            { href: '#profile-basic', label: dashboardInlineText(lang, 'profile_b5886d60') },
            { href: '#profile-security', label: dashboardInlineText(lang, 'security_a4dd2249') },
            {
              href: '#profile-notifications',
              label: dashboardInlineText(lang, 'notifications_e0d1fbb4'),
            },
            { href: '#profile-devices', label: dashboardInlineText(lang, 'devices_eb11d1c2') },
          ]}
        />

        <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <AdminPanel
            title={dashboardInlineText(lang, 'account_overview_69c823ae')}
            description={dashboardInlineText(
              lang,
              'a_profile_page_should_start_with_identity_summar_267864f9'
            )}
          >
            <div className="mb-4 flex items-center gap-4">
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-admin-primary text-xl font-bold text-white dark:text-slate-950">
                {initials}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-admin-text">
                  {profile.displayName ?? profile.email}
                </h2>
                <p className="truncate text-sm text-admin-text-muted">{profile.email}</p>
              </div>
            </div>
            <FactList
              lang={lang}
              items={[
                {
                  label: dashboardInlineText(lang, 'current_workspace_325f034a'),
                  value: formatWorkspaceLabel(lang, profile.workspaceId),
                },
                {
                  label: dashboardInlineText(lang, 'account_role_e58f704e'),
                  value: formatUserRole(lang, profile.role),
                },
                {
                  label: dashboardInlineText(lang, 'team_role_99090a66'),
                  value: formatUserRole(lang, profile.workspaceRole),
                },
                { label: copy.timezone, value: profile.timezone ?? 'Asia/Hong_Kong' },
              ]}
            />
          </AdminPanel>

          <AdminPanel
            id="profile-basic"
            title={dashboardInlineText(lang, 'profile_information_a92b4b1f')}
            description={dashboardInlineText(
              lang,
              'these_fields_control_your_display_profile_and_la_6d305458'
            )}
          >
            <form action={updateProfileAction} className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium text-admin-text">
                  <span>{copy.displayName}</span>
                  <Input
                    name="displayName"
                    defaultValue={profile.displayName ?? ''}
                    maxLength={80}
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium text-admin-text">
                  <span>{copy.avatarUrl}</span>
                  <Input name="avatarUrl" defaultValue={profile.avatarUrl ?? ''} maxLength={500} />
                </label>
                <label className="grid gap-2 text-sm font-medium text-admin-text">
                  <span>{copy.language}</span>
                  <Select name="language" defaultValue={profile.language ?? lang}>
                    <option value="zh">{copy.chinese}</option>
                    <option value="en">English</option>
                  </Select>
                </label>
                <label className="grid gap-2 text-sm font-medium text-admin-text">
                  <span>{copy.timezone}</span>
                  <Input
                    name="timezone"
                    defaultValue={profile.timezone ?? 'Asia/Hong_Kong'}
                    maxLength={80}
                  />
                </label>
              </div>
              <button type="submit" className={`${dashboardPrimaryButtonClass} w-fit`}>
                {copy.saveProfile}
              </button>
            </form>
          </AdminPanel>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <AdminPanel
            id="profile-security"
            title={dashboardInlineText(lang, 'security_579a3882')}
            description={dashboardInlineText(
              lang,
              'password_changes_are_high_risk_and_should_live_i_8857ca3e'
            )}
          >
            <form action={changePasswordAction} className="grid gap-4">
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{copy.currentPassword}</span>
                <Input name="currentPassword" type="password" autoComplete="current-password" />
              </label>
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{copy.newPassword}</span>
                <Input
                  name="newPassword"
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              <ConfirmSubmitButton
                type="submit"
                className={`${dashboardPrimaryButtonClass} w-fit`}
                confirmation={copy.changePasswordConfirm}
              >
                {copy.changePassword}
              </ConfirmSubmitButton>
            </form>
          </AdminPanel>

          <AdminPanel
            id="profile-notifications"
            title={copy.notificationPrefs}
            description={dashboardInlineText(
              lang,
              'notification_preferences_belong_in_account_setti_e1dca29a'
            )}
          >
            <form action={updateNotificationPreferencesAction} className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Switch name="inApp" label={copy.inApp} defaultChecked={notifications.inApp} />
                <Switch
                  name="email"
                  label={copy.emailDelivery}
                  defaultChecked={notifications.email}
                />
                <Switch
                  name="billing"
                  label={copy.billingEvents}
                  defaultChecked={notifications.billing}
                />
                <Switch name="files" label={copy.fileEvents} defaultChecked={notifications.files} />
                <Switch
                  name="admin"
                  label={copy.workspaceAdminEvents}
                  defaultChecked={notifications.admin}
                />
              </div>
              <button type="submit" className={`${dashboardPrimaryButtonClass} w-fit`}>
                {copy.savePrefs}
              </button>
            </form>
          </AdminPanel>
        </section>

        <AdminPanel
          id="profile-devices"
          title={dashboardInlineText(lang, 'signed_in_devices_e52e6485')}
          description={dashboardInlineText(lang, 'revoke_any_device_you_do_not_recognize_bc42b115')}
        >
          <TimelineList
            lang={lang}
            empty={dashboardInlineText(lang, 'no_other_devices_are_signed_in_90373bf6')}
            items={sessions.map((session) => ({
              key: session.id,
              title: dashboardInlineText(lang, 'browser_device_f4bc3185'),
              description: `${formatUserDate(lang, session.createdAt)} - ${formatUserDate(lang, session.expiresAt)}`,
              meta: (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <ConfirmSubmitButton
                    type="submit"
                    className={dashboardGhostButtonClass}
                    confirmation={copy.revokeSessionConfirm(session.id)}
                  >
                    {copy.revoke}
                  </ConfirmSubmitButton>
                </form>
              ),
              status: 'active',
              statusTone: 'success',
              tone: 'success',
            }))}
          />
        </AdminPanel>
      </div>
    </WorkspaceShell>
  );
}

export function DashboardProfileOperationsPage({
  lang,
  profile,
  sessions,
  updateProfileAction,
  updateNotificationPreferencesAction,
  changePasswordAction,
  revokeSessionAction,
}: {
  lang: SupportedLanguage;
  profile: HostUserProfile;
  sessions: HostAuthSessionRecord[];
  updateProfileAction: AdminFormAction;
  updateNotificationPreferencesAction: AdminFormAction;
  changePasswordAction: AdminFormAction;
  revokeSessionAction: AdminFormAction;
}) {
  return (
    <DashboardProfileOperationsPageV2
      lang={lang}
      profile={profile}
      sessions={sessions}
      updateProfileAction={updateProfileAction}
      updateNotificationPreferencesAction={updateNotificationPreferencesAction}
      changePasswordAction={changePasswordAction}
      revokeSessionAction={revokeSessionAction}
    />
  );
}

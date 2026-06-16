import { WorkspaceShell } from '@host/components/ProductShell';
import { Button, ButtonLink, ConfirmSubmitButton, Switch } from '@host/components/ui';
import { ActionPanel, AdminPanel, PageSynopsis } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import type { HostUserPreferences } from '@host/lib/user-api';
import type { RuntimeStoreNotificationRecord } from '@/lib/module-runtime';
import {
  UserEmptyState,
  UserRecordCard,
  dashboardGhostButtonClass,
  dashboardPrimaryButtonClass,
  formatNotificationBody,
  formatNotificationCategory,
  formatNotificationTitle,
  formatUserDate,
} from '../dashboard/pages/DashboardPageUtils';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function DashboardNotificationsOperationsPage({
  lang,
  notifications,
  markNotificationReadAction,
  markAllNotificationsReadAction,
}: {
  lang: SupportedLanguage;
  notifications: RuntimeStoreNotificationRecord[];
  markNotificationReadAction: AdminFormAction;
  markAllNotificationsReadAction: AdminFormAction;
}) {
  const copy = getDashboardCopy(lang).notifications;
  const unread = notifications.filter((item) => item.status === 'unread').length;
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <div className="grid gap-4">
        <PageSynopsis
          lang={lang}
          title={dashboardInlineText(lang, 'notification_overview_6bb974c8')}
          description={copy.subtitle}
          items={[
            {
              key: 'unread',
              label: dashboardInlineText(lang, 'unread_7a7f2db0'),
              value: String(unread),
              tone: unread > 0 ? 'warning' : 'success',
            },
            {
              key: 'total',
              label: dashboardInlineText(lang, 'notifications_3a84e0b5'),
              value: String(notifications.length),
              tone: 'primary',
            },
            {
              key: 'read',
              label: dashboardInlineText(lang, 'read_19b1eb84'),
              value: String(notifications.length - unread),
              tone: 'info',
            },
          ]}
        />
        <ActionPanel
          title={copy.readAll}
          description={copy.readAllBody}
          tone={unread > 0 ? 'warning' : 'success'}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ButtonLink
                href={localizedPath(lang, '/dashboard/settings/notifications')}
                variant="secondary"
                size="small"
              >
                {dashboardInlineText(lang, 'settings_860006f3')}
              </ButtonLink>
              <form action={markAllNotificationsReadAction}>
                <ConfirmSubmitButton
                  type="submit"
                  className={dashboardGhostButtonClass}
                  disabled={unread === 0}
                  confirmation={copy.readAllConfirm}
                >
                  {copy.markRead}
                </ConfirmSubmitButton>
              </form>
            </div>
          }
        />
        <AdminPanel
          title={dashboardInlineText(lang, 'inbox_10fe3744')}
          description={dashboardInlineText(lang, 'notifications_are_listed_by_time_6805112b')}
        >
          {notifications.length > 0 ? (
            <div className="grid gap-3">
              {notifications.map((item) => (
                <UserRecordCard
                  key={item.id}
                  lang={lang}
                  title={formatNotificationTitle(lang, item)}
                  description={formatNotificationBody(lang, item)}
                  meta={`${formatNotificationCategory(lang, item.category)} · ${formatUserDate(lang, item.createdAt)}`}
                  status={item.status}
                  actions={
                    <form action={markNotificationReadAction} className="inline-flex">
                      <input type="hidden" name="notificationId" value={item.id} />
                      <ConfirmSubmitButton
                        type="submit"
                        className={dashboardGhostButtonClass}
                        disabled={item.status === 'read'}
                        confirmation={copy.markOneConfirm(formatNotificationTitle(lang, item))}
                      >
                        {copy.markRead}
                      </ConfirmSubmitButton>
                    </form>
                  }
                />
              ))}
            </div>
          ) : (
            <UserEmptyState
              title={dashboardInlineText(lang, 'no_notifications_2e1acc9e')}
              body={dashboardInlineText(
                lang,
                'task_billing_and_team_updates_will_appear_here_3a75ed75'
              )}
              action={
                <ButtonLink
                  href={localizedPath(lang, '/dashboard/settings/notifications')}
                  variant="secondary"
                  size="small"
                >
                  {dashboardInlineText(lang, 'notification_settings_0f8fc979')}
                </ButtonLink>
              }
            />
          )}
        </AdminPanel>
      </div>
    </WorkspaceShell>
  );
}

export function DashboardNotificationSettingsOperationsPage({
  lang,
  preferences,
  updatePreferencesAction,
}: {
  lang: SupportedLanguage;
  preferences: HostUserPreferences;
  updatePreferencesAction: AdminFormAction;
}) {
  const copy = getDashboardCopy(lang).notificationSettings;
  const preferenceCopy = getDashboardCopy(lang).profile;
  const notifications = preferences.notifications;
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <AdminPanel
        title={dashboardInlineText(lang, 'notification_preferences_7c17fb01')}
        description={dashboardInlineText(
          lang,
          'choose_the_kinds_of_notifications_and_delivery_m_ecd74220'
        )}
      >
        <form action={updatePreferencesAction} className="grid gap-4">
          <div className="grid gap-4">
            <h2 className="text-sm font-semibold text-admin-text">
              {dashboardInlineText(lang, 'delivery_methods_2c070608')}
            </h2>
            <Switch
              name="inApp"
              label={preferenceCopy.inApp}
              defaultChecked={notifications.inApp}
            />
            <Switch
              name="email"
              label={preferenceCopy.emailDelivery}
              defaultChecked={notifications.email}
            />
          </div>
          <div className="grid gap-4">
            <h2 className="text-sm font-semibold text-admin-text">
              {dashboardInlineText(lang, 'notification_types_0adb1cf6')}
            </h2>
            <Switch
              name="billing"
              label={preferenceCopy.billingEvents}
              defaultChecked={notifications.billing}
            />
            <Switch
              name="files"
              label={preferenceCopy.fileEvents}
              defaultChecked={notifications.files}
            />
            <Switch
              name="admin"
              label={preferenceCopy.workspaceAdminEvents}
              defaultChecked={notifications.admin}
            />
          </div>
          <Button type="submit" className={`${dashboardPrimaryButtonClass} w-fit`}>
            {copy.save}
          </Button>
        </form>
      </AdminPanel>
    </WorkspaceShell>
  );
}

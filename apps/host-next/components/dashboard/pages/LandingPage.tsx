import { WorkspaceShell } from '@host/components/ProductShell';
import { ButtonLink } from '@host/components/ui';
import {
  ActionPanel,
  AdminPanel,
  PageSynopsis,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import type { HostUserProfile } from '@host/lib/user-api';
import type { UserSaasSnapshot } from '@host/lib/saas-operations';
import {
  UserEmptyState,
  UserRecordCard,
  formatBillingPlan,
  formatBillingSku,
  formatCreditUnit,
  formatEntitlementLabel,
  formatNotificationBody,
  formatNotificationTitle,
  formatOrderAmount,
  formatUserDate,
  formatWorkspaceLabel,
} from './DashboardPageUtils';

export function DashboardLandingPage({
  lang,
  snapshot,
  profile,
}: {
  lang: SupportedLanguage;
  snapshot: UserSaasSnapshot;
  profile: HostUserProfile;
}) {
  const copy = getDashboardCopy(lang).landing;
  const unread = snapshot.notifications.filter((item) => item.status === 'unread').length;
  const activeEntitlement = snapshot.entitlements.find((item) => item.status === 'active');
  const recentNotifications = snapshot.notifications.slice(0, 5);
  const recentOrders = snapshot.orders.slice(0, 3);
  const runningTasks = snapshot.tasks.filter(
    (run) => run.status === 'running' || run.status === 'queued'
  ).length;

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <PageSynopsis
        lang={lang}
        title={profile.displayName ?? profile.email}
        description={dashboardInlineText(
          lang,
          'welcome_back_start_with_what_needs_attention_tod_0e1c25b9'
        )}
        status={profile.status}
        statusTone={profile.status === 'active' ? 'success' : 'warning'}
        action={
          <ButtonLink
            href={localizedPath(lang, '/dashboard/profile')}
            variant="secondary"
            size="small"
          >
            {copy.profile}
          </ButtonLink>
        }
        items={[
          {
            key: 'workspace',
            label: dashboardInlineText(lang, 'current_workspace_325f034a'),
            value: formatWorkspaceLabel(lang, profile.workspaceId),
            tone: 'primary',
          },
          {
            key: 'credits',
            label: dashboardInlineText(lang, 'credits_70d04d46'),
            value: String(snapshot.creditBalance.balance),
            detail: formatCreditUnit(lang, snapshot.creditBalance.unit),
            tone: 'success',
          },
          {
            key: 'plan',
            label: dashboardInlineText(lang, 'plan_90212e66'),
            value: formatBillingPlan(lang, activeEntitlement?.planId),
            detail: formatEntitlementLabel(lang, activeEntitlement?.entitlement),
            tone: activeEntitlement ? 'success' : 'neutral',
          },
          {
            key: 'unread',
            label: dashboardInlineText(lang, 'unread_45848609'),
            value: String(unread),
            detail:
              unread > 0
                ? dashboardInlineText(lang, 'needs_review_ab1a4a04')
                : copy.noNotifications,
            tone: unread > 0 ? 'warning' : 'neutral',
          },
        ]}
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <AdminPanel
          title={dashboardInlineText(lang, 'needs_your_attention_b25ac3ea')}
          description={dashboardInlineText(
            lang,
            'only_reminders_that_affect_your_next_step_are_sh_4b3d4d47'
          )}
        >
          <div className="grid gap-3">
            <UserRecordCard
              lang={lang}
              title={dashboardInlineText(lang, 'review_notifications_d32c0109')}
              description={
                unread > 0
                  ? dashboardInlineText(lang, 'you_have_value_unread_notification_value_90d2cb19', {
                      value1: unread,
                      value2: unread === 1 ? '' : 's',
                    })
                  : dashboardInlineText(lang, 'no_new_notifications_right_now_d6dcf247')
              }
              status={unread > 0 ? 'unread' : 'read'}
              actions={
                <ButtonLink
                  href={localizedPath(lang, '/dashboard/notifications')}
                  variant={unread > 0 ? 'solid' : 'secondary'}
                  size="small"
                >
                  {dashboardInlineText(lang, 'open_notifications_f70313dc')}
                </ButtonLink>
              }
            />
            <UserRecordCard
              lang={lang}
              title={dashboardInlineText(lang, 'continue_tasks_1c1eeb4b')}
              description={
                runningTasks > 0
                  ? dashboardInlineText(lang, 'value_task_value_in_progress_1b82dbb6', {
                      value1: runningTasks,
                      value2: runningTasks === 1 ? '' : 's',
                    })
                  : dashboardInlineText(lang, 'no_task_is_waiting_on_you_2010c145')
              }
              status={runningTasks > 0 ? 'running' : 'succeeded'}
              actions={
                <ButtonLink href={localizedPath(lang, '/dashboard/tasks')} variant="secondary" size="small">
                  {dashboardInlineText(lang, 'view_tasks_5f74b4a8')}
                </ButtonLink>
              }
            />
            <UserRecordCard
              lang={lang}
              title={dashboardInlineText(lang, 'check_billing_c05b2b93')}
              description={
                activeEntitlement
                  ? formatEntitlementLabel(lang, activeEntitlement.entitlement)
                  : copy.baseEntitlement
              }
              status={activeEntitlement ? 'active' : 'inactive'}
              actions={
                <ButtonLink href={localizedPath(lang, '/dashboard/billing')} variant="secondary" size="small">
                  {copy.billing}
                </ButtonLink>
              }
            />
          </div>
        </AdminPanel>
        <div className="grid gap-4">
          <ActionPanel
            title={copy.billing}
            description={`${formatBillingPlan(lang, activeEntitlement?.planId)} · ${formatEntitlementLabel(lang, activeEntitlement?.entitlement)}`}
            tone={activeEntitlement ? 'success' : 'primary'}
            actions={
              <ButtonLink href={localizedPath(lang, '/dashboard/billing')} variant="solid" size="small">
                {copy.billing}
              </ButtonLink>
            }
          />
          <ActionPanel
            title={copy.workspace}
            description={formatWorkspaceLabel(lang, profile.workspaceId)}
            tone="neutral"
            actions={
              <ButtonLink
                href={localizedPath(lang, '/dashboard/workspaces')}
                variant="secondary"
                size="small"
              >
                {copy.workspace}
              </ButtonLink>
            }
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <AdminPanel
          title={dashboardInlineText(lang, 'recent_notifications_2517e7e3')}
          description={dashboardInlineText(lang, 'the_latest_updates_related_to_you_ed4010f1')}
        >
          {recentNotifications.length > 0 ? (
            <div className="grid gap-3">
              {recentNotifications.map((notification) => (
                <UserRecordCard
                  key={notification.id}
                  lang={lang}
                  title={formatNotificationTitle(lang, notification)}
                  description={formatNotificationBody(lang, notification)}
                  meta={formatUserDate(lang, notification.createdAt)}
                  status={notification.status}
                />
              ))}
            </div>
          ) : (
            <UserEmptyState
              title={copy.noNotifications}
              body={dashboardInlineText(
                lang,
                'task_billing_and_team_updates_will_appear_here_090333a7'
              )}
            />
          )}
        </AdminPanel>
        <AdminPanel
          title={dashboardInlineText(lang, 'recent_orders_2e151682')}
          description={dashboardInlineText(lang, 'your_latest_purchases_and_receipts_11a7f2ae')}
        >
          {recentOrders.length > 0 ? (
            <div className="grid gap-3">
              {recentOrders.map((order) => (
                <UserRecordCard
                  key={order.id}
                  lang={lang}
                  title={formatBillingSku(order.sku)}
                  description={formatOrderAmount(lang, order.amount, order.currency)}
                  meta={formatUserDate(lang, order.updatedAt)}
                  status={order.status}
                  actions={
                    <ButtonLink href={localizedPath(lang, '/dashboard/orders')} variant="secondary" size="small">
                      {dashboardInlineText(lang, 'view_order_88c88f23')}
                    </ButtonLink>
                  }
                />
              ))}
            </div>
          ) : (
            <UserEmptyState
              title={dashboardInlineText(lang, 'no_orders_yet_b6d57cb8')}
              body={dashboardInlineText(
                lang,
                'after_checkout_orders_and_receipts_will_appear_h_8192f0e3'
              )}
              action={
                <ButtonLink href={localizedPath(lang, '/dashboard/billing')} variant="secondary" size="small">
                  {copy.billing}
                </ButtonLink>
              }
            />
          )}
        </AdminPanel>
      </section>
    </WorkspaceShell>
  );
}

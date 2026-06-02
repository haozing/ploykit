import Link from 'next/link';
import type { ReactNode } from 'react';
import { adminNav, EmptyState, FormField, WorkspaceShell } from '@host/components/ProductShell';
import {
  Button,
  ButtonLink,
  ConfirmSubmitButton,
  DataTable,
  Input,
  Pagination,
  Select,
  Switch,
  TableToolbar,
  Toast,
} from '@host/components/ui';
import { CopyButton } from '@host/components/ui/CopyButton';
import {
  ActionPanel,
  AdminPanel,
  FactList,
  PageSynopsis,
  TimelineList,
} from '@host/components/admin/shared/AdminPrimitives';
import { StatusBadge as AdminStatusBadge } from '@host/components/admin/shared/StatusBadge';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatBytes, formatCurrencyMinor } from '@host/lib/i18n-format';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type {
  AdminOperationsSnapshot,
  ProductScopeDomainAlias,
  ProductScopeInvite,
  ProductScopeMembership,
  ProductScopeProduct,
  ProductScopeWorkspace,
  RuntimeStoreAuditRecord,
  RuntimeStoreCommercialOrder,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreFileRecord,
  RuntimeStoreHostUser,
  RuntimeStoreMeteringLedgerEntry,
  RuntimeStoreNotificationRecord,
  RuntimeStoreUsageRecord,
} from '@/lib/module-runtime';
import { redactSensitive } from '@/lib/module-runtime/observability/redaction';
import type { HostBillingOverview } from '@host/lib/billing-api';
import type { HostConfigDoctorReport } from '@host/lib/config-doctor';
import type { HostFileQuotaStatus, HostFileStorageStatus } from '@host/lib/files';
import type { HostRuntimeHealth } from '@host/lib/host-health';
import type { HostIdentityUserDetailView } from '@host/lib/identity-operations';
import type { HostRuntimeStoreStatus } from '@host/lib/runtime-store';
import type { HostAuthSessionRecord } from '@host/lib/auth';
import type { HostUserPreferences, HostUserProfile } from '@host/lib/user-api';
import type { UserSaasSnapshot } from '@host/lib/saas-operations';
import type {
  AdminCommercialView,
  AdminFileDetailView,
  AdminHostSettingsView,
  AdminModuleDevConsoleView,
  AdminModuleDetailView,
  AdminOperationsViewSnapshot,
  AdminOutboxDetailView,
  AdminRunDetailView,
  AdminServiceConnectionsView,
} from '@host/lib/admin-operations';
import {
  FriendlyStatusBadge,
  ProgressBar,
  UserEmptyState,
  UserHashPanel,
  UserRecordCard,
  UserSectionNav,
  dashboardGhostButtonClass,
  dashboardPrimaryButtonClass,
  formatBillingPlan,
  formatBillingSku,
  formatCreditAmount,
  formatCreditReason,
  formatCreditUnit,
  formatDashboardModuleLabel,
  formatEntitlementLabel,
  formatFilePurpose,
  formatFileType,
  formatMoneyAmount,
  formatNotificationBody,
  formatNotificationCategory,
  formatNotificationTitle,
  formatOrderAmount,
  formatPaymentMethodLabel,
  formatProductLabel,
  formatStorageLabel,
  formatTaskName,
  formatTaskResult,
  formatUserDate,
  formatUserLanguage,
  formatUserRole,
  formatWorkspaceDisplayName,
  formatWorkspaceLabel,
  friendlyStatusLabel,
  progressDescription,
} from './DashboardPageUtils';

type AdminFormAction = (formData: FormData) => void | Promise<void>;
type ProductScopeMemberRow = ProductScopeMembership & {
  user: {
    id: string;
    email?: string;
    role?: string;
    status?: string;
  } | null;
};

interface ProductScopePageScope {
  product: ProductScopeProduct | null;
  workspace: ProductScopeWorkspace | null;
  products: ProductScopeProduct[];
  workspaces: ProductScopeWorkspace[];
  membership: ProductScopeMembership | null;
}

interface AdminPagedResult<T> {
  items: T[];
  page: {
    total: number;
    offset: number;
    limit: number;
  };
}

interface AdminSearchResult {
  type: string;
  id: string;
  label: string;
}

interface AdminWorkerStatusView {
  workerId: string;
  heartbeatAt: string | null;
  lastDrainAt: string | null;
  queue: {
    queued: number;
    processing: number;
    failed: number;
    deadLettered: number;
    oldestPendingAt: string | null;
    lagMs: number;
  };
  alerts: {
    code: string;
    severity: 'warning' | 'error';
    message: string;
    metric: string;
    threshold: number;
    value: number;
  }[];
}

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
  const recentTasks = snapshot.tasks.slice(0, 5);
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
                <ButtonLink
                  href={localizedPath(lang, '/dashboard/tasks')}
                  variant="secondary"
                  size="small"
                >
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
                <ButtonLink
                  href={localizedPath(lang, '/dashboard/billing')}
                  variant="secondary"
                  size="small"
                >
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
              <ButtonLink
                href={localizedPath(lang, '/dashboard/billing')}
                variant="solid"
                size="small"
              >
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
                    <ButtonLink
                      href={localizedPath(lang, '/dashboard/orders')}
                      variant="secondary"
                      size="small"
                    >
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
                <ButtonLink
                  href={localizedPath(lang, '/dashboard/billing')}
                  variant="secondary"
                  size="small"
                >
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

export function DashboardWorkspacesOperationsPage({
  lang,
  scope,
  members,
  invitations,
  aliases,
  switchWorkspaceAction,
  createWorkspaceAction,
  createInvitationAction,
  updateInvitationAction,
  upsertDomainAliasAction,
}: {
  lang: SupportedLanguage;
  scope: ProductScopePageScope;
  members: ProductScopeMemberRow[];
  invitations: ProductScopeInvite[];
  aliases: ProductScopeDomainAlias[];
  switchWorkspaceAction: AdminFormAction;
  createWorkspaceAction: AdminFormAction;
  createInvitationAction: AdminFormAction;
  updateInvitationAction: AdminFormAction;
  upsertDomainAliasAction: AdminFormAction;
}) {
  return (
    <DashboardWorkspacesOperationsPageV2
      lang={lang}
      scope={scope}
      members={members}
      invitations={invitations}
      aliases={aliases}
      switchWorkspaceAction={switchWorkspaceAction}
      createWorkspaceAction={createWorkspaceAction}
      createInvitationAction={createInvitationAction}
      updateInvitationAction={updateInvitationAction}
      upsertDomainAliasAction={upsertDomainAliasAction}
    />
  );
}

export function DashboardSimplePage({
  lang,
  title,
  subtitle,
}: {
  lang: SupportedLanguage;
  title: string;
  subtitle: string;
}) {
  const copy = getDashboardCopy(lang).simple;
  return (
    <WorkspaceShell lang={lang} title={title} subtitle={subtitle}>
      <EmptyState title={copy.emptyTitle}>{copy.emptyBody}</EmptyState>
    </WorkspaceShell>
  );
}

function DashboardWorkspacesOperationsPageV2({
  lang,
  scope,
  members,
  invitations,
  aliases,
  switchWorkspaceAction,
  createWorkspaceAction,
  createInvitationAction,
  updateInvitationAction,
  upsertDomainAliasAction,
}: {
  lang: SupportedLanguage;
  scope: ProductScopePageScope;
  members: ProductScopeMemberRow[];
  invitations: ProductScopeInvite[];
  aliases: ProductScopeDomainAlias[];
  switchWorkspaceAction: AdminFormAction;
  createWorkspaceAction: AdminFormAction;
  createInvitationAction: AdminFormAction;
  updateInvitationAction: AdminFormAction;
  upsertDomainAliasAction: AdminFormAction;
}) {
  const copy = getDashboardCopy(lang).workspaces;
  const currentWorkspaceId = scope.workspace?.id ?? '';
  const currentProductId = scope.product?.id ?? scope.products[0]?.id ?? '';
  const currentWorkspaceName = scope.workspace
    ? formatWorkspaceDisplayName(lang, scope.workspace.name)
    : dashboardInlineText(lang, 'no_workspace_selected_862a3762');
  const pendingInvitations = invitations.filter((invite) => invite.status === 'pending').length;
  const workspaceNameById = new Map(
    scope.workspaces.map((workspace) => [
      workspace.id,
      formatWorkspaceDisplayName(lang, workspace.name),
    ])
  );

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <div className="grid gap-4">
        <PageSynopsis
          lang={lang}
          title={dashboardInlineText(lang, 'workspace_list_67863cf5')}
          description={dashboardInlineText(
            lang,
            'choose_a_workspace_first_then_manage_members_inv_bd41ac7c'
          )}
          status={scope.workspace?.id ? 'active' : 'missing'}
          statusTone={scope.workspace?.id ? 'success' : 'warning'}
          items={[
            {
              key: 'workspace',
              label: dashboardInlineText(lang, 'current_workspace_325f034a'),
              value: currentWorkspaceName,
              tone: 'primary',
            },
            {
              key: 'members',
              label: dashboardInlineText(lang, 'members_a4462f09'),
              value: String(members.length),
              tone: 'info',
            },
            {
              key: 'invites',
              label: dashboardInlineText(lang, 'pending_invites_fcc3f8cc'),
              value: String(pendingInvitations),
              tone: pendingInvitations > 0 ? 'warning' : 'success',
            },
            {
              key: 'access',
              label: dashboardInlineText(lang, 'access_addresses_1047c56b'),
              value: String(aliases.length),
              tone: aliases.length > 0 ? 'success' : 'neutral',
            },
          ]}
        />

        <UserSectionNav
          items={[
            { href: '#workspace-list', label: dashboardInlineText(lang, 'workspaces_7e3e2011') },
            { href: '#workspace-members', label: dashboardInlineText(lang, 'members_a4462f09') },
            {
              href: '#workspace-invitations',
              label: dashboardInlineText(lang, 'invitations_14a2745d'),
            },
            { href: '#workspace-access', label: dashboardInlineText(lang, 'access_647d5f80') },
          ]}
        />

        <AdminPanel
          id="workspace-list"
          title={dashboardInlineText(lang, 'workspaces_a4215336')}
          description={dashboardInlineText(
            lang,
            'this_page_starts_with_the_workspace_list_instead_35cbf631'
          )}
          action={
            <UserHashPanel
              lang={lang}
              id="new-workspace-panel"
              triggerLabel={copy.createWorkspace}
              title={copy.createWorkspace}
              description={dashboardInlineText(
                lang,
                'a_new_workspace_has_separate_members_files_billi_3a6e703c'
              )}
            >
              <form action={createWorkspaceAction} className="grid gap-4">
                <input type="hidden" name="productId" value={currentProductId} />
                <label className="grid gap-2 text-sm font-medium text-admin-text">
                  <span>{copy.name}</span>
                  <Input
                    name="name"
                    placeholder={dashboardInlineText(lang, 'for_example_team_ops_ae637df2')}
                  />
                </label>
                <button type="submit" className={`${dashboardPrimaryButtonClass} w-fit`}>
                  {copy.create}
                </button>
              </form>
            </UserHashPanel>
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {scope.workspaces.map((workspace) => {
              const selected = workspace.id === currentWorkspaceId;
              return (
                <UserRecordCard
                  key={workspace.id}
                  lang={lang}
                  title={formatWorkspaceDisplayName(lang, workspace.name)}
                  description={
                    selected
                      ? dashboardInlineText(lang, 'this_workspace_is_currently_selected_7c45d1cc')
                      : dashboardInlineText(
                          lang,
                          'switch_to_manage_its_members_and_settings_a414caa7'
                        )
                  }
                  status={selected ? 'active' : 'available'}
                  details={[
                    {
                      label: dashboardInlineText(lang, 'management_0b9e8abe'),
                      value: dashboardInlineText(lang, 'members_invitations_access_348bb54b'),
                    },
                  ]}
                  actions={
                    selected ? (
                      <a href="#workspace-members" className={dashboardGhostButtonClass}>
                        {dashboardInlineText(lang, 'manage_233004f6')}
                      </a>
                    ) : (
                      <form action={switchWorkspaceAction}>
                        <input type="hidden" name="workspaceId" value={workspace.id} />
                        <button type="submit" className={dashboardGhostButtonClass}>
                          {copy.use}
                        </button>
                      </form>
                    )
                  }
                />
              );
            })}
          </div>
        </AdminPanel>

        <section className="grid gap-4 xl:grid-cols-2">
          <AdminPanel
            id="workspace-members"
            title={dashboardInlineText(lang, 'value_members_19133948', {
              value1: currentWorkspaceName,
            })}
            description={dashboardInlineText(
              lang,
              'members_shown_here_belong_to_the_current_workspa_01c1d6f3'
            )}
            action={
              <UserHashPanel
                lang={lang}
                id="invite-member-panel"
                triggerLabel={copy.invite}
                title={copy.invite}
                description={dashboardInlineText(
                  lang,
                  'invite_a_teammate_to_the_current_workspace_by_em_99676bcd'
                )}
                variant="secondary"
              >
                <form action={createInvitationAction} className="grid gap-4">
                  <input type="hidden" name="workspaceId" value={currentWorkspaceId} />
                  <label className="grid gap-2 text-sm font-medium text-admin-text">
                    <span>{copy.email}</span>
                    <Input
                      name="email"
                      type="email"
                      placeholder={dashboardInlineText(lang, 'member_email_placeholder_1aefb764')}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-admin-text">
                    <span>{copy.role}</span>
                    <Select name="role" defaultValue="editor">
                      <option value="viewer">{formatUserRole(lang, 'viewer')}</option>
                      <option value="editor">{formatUserRole(lang, 'editor')}</option>
                      <option value="admin">{formatUserRole(lang, 'admin')}</option>
                      <option value="owner">{formatUserRole(lang, 'owner')}</option>
                    </Select>
                  </label>
                  <button type="submit" className={`${dashboardPrimaryButtonClass} w-fit`}>
                    {copy.sendInvite}
                  </button>
                </form>
              </UserHashPanel>
            }
          >
            {members.length > 0 ? (
              <div className="grid gap-3">
                {members.map((member) => (
                  <UserRecordCard
                    key={member.userId}
                    lang={lang}
                    title={member.user?.email ?? dashboardInlineText(lang, 'team_member_3e5a1366')}
                    description={formatUserRole(lang, member.role)}
                    status={member.status}
                  />
                ))}
              </div>
            ) : (
              <UserEmptyState
                title={dashboardInlineText(lang, 'no_members_yet_316c5580')}
                body={dashboardInlineText(
                  lang,
                  'members_will_appear_here_after_they_accept_an_in_b8c58dfa'
                )}
              />
            )}
          </AdminPanel>

          <AdminPanel
            id="workspace-invitations"
            title={dashboardInlineText(lang, 'invitations_14a2745d')}
            description={dashboardInlineText(
              lang,
              'users_only_need_to_know_who_was_invited_their_ro_d947284d'
            )}
          >
            {invitations.length > 0 ? (
              <div className="grid gap-3">
                {invitations.map((invite) => (
                  <UserRecordCard
                    key={invite.token}
                    lang={lang}
                    title={invite.email}
                    description={formatUserRole(lang, invite.role)}
                    meta={formatUserDate(lang, invite.expiresAt)}
                    status={invite.status}
                    actions={
                      invite.status === 'pending' ? (
                        <form action={updateInvitationAction}>
                          <input type="hidden" name="workspaceId" value={invite.workspaceId} />
                          <input type="hidden" name="token" value={invite.token} />
                          <input type="hidden" name="action" value="revoke" />
                          <ConfirmSubmitButton
                            className={dashboardGhostButtonClass}
                            confirmation={copy.revokeConfirm(invite.email)}
                          >
                            {copy.revoke}
                          </ConfirmSubmitButton>
                        </form>
                      ) : null
                    }
                  />
                ))}
              </div>
            ) : (
              <UserEmptyState
                title={dashboardInlineText(lang, 'no_invitations_d0b5f3a4')}
                body={dashboardInlineText(
                  lang,
                  'pending_invitations_will_appear_here_after_you_s_16d15cea'
                )}
              />
            )}
          </AdminPanel>
        </section>

        <AdminPanel
          id="workspace-access"
          title={dashboardInlineText(lang, 'access_addresses_1047c56b')}
          description={dashboardInlineText(
            lang,
            'access_addresses_are_workspace_settings_and_belo_73edd9a6'
          )}
          action={
            <UserHashPanel
              lang={lang}
              id="bind-domain-panel"
              triggerLabel={copy.bindDomain}
              title={copy.bindDomain}
              description={dashboardInlineText(
                lang,
                'enter_the_address_your_team_should_use_then_comp_3052967a'
              )}
              variant="secondary"
            >
              <form action={upsertDomainAliasAction} className="grid gap-4">
                <input type="hidden" name="productId" value={currentProductId} />
                <input type="hidden" name="workspaceId" value={currentWorkspaceId} />
                <label className="grid gap-2 text-sm font-medium text-admin-text">
                  <span>{dashboardInlineText(lang, 'access_address_4527d44d')}</span>
                  <Input
                    name="hostname"
                    placeholder={dashboardInlineText(lang, 'team_domain_placeholder_0f966e50')}
                  />
                </label>
                <button type="submit" className={`${dashboardPrimaryButtonClass} w-fit`}>
                  {copy.save}
                </button>
              </form>
            </UserHashPanel>
          }
        >
          {aliases.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {aliases.map((alias) => (
                <UserRecordCard
                  key={`${alias.hostname}:${alias.workspaceId ?? alias.productId}`}
                  lang={lang}
                  title={alias.hostname}
                  description={
                    alias.workspaceId
                      ? (workspaceNameById.get(alias.workspaceId) ?? currentWorkspaceName)
                      : formatProductLabel(lang, alias.productId)
                  }
                  status="active"
                />
              ))}
            </div>
          ) : (
            <UserEmptyState
              title={dashboardInlineText(lang, 'no_access_address_yet_c8f4321f')}
              body={dashboardInlineText(
                lang,
                'add_an_address_so_members_can_reach_this_workspa_5632bab6'
              )}
            />
          )}
        </AdminPanel>
      </div>
    </WorkspaceShell>
  );
}

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

function DashboardBillingOperationsPageV2({
  lang,
  overview,
}: {
  lang: SupportedLanguage;
  overview: HostBillingOverview;
}) {
  const copy = getDashboardCopy(lang).billing;
  const { snapshot, provider, invoices, paymentMethods, taxProfile, catalog } = overview;
  const profileText = (key: string) =>
    typeof taxProfile[key] === 'string' ? String(taxProfile[key]) : '';
  const checkoutSku = catalog.skus.find((sku) => sku.status !== 'archived') ?? catalog.skus[0];
  const activeEntitlement =
    snapshot.entitlements.find((item) => item.status === 'active') ?? snapshot.entitlements[0];
  const activePlan = activeEntitlement?.planId ?? checkoutSku?.planId;
  const paymentReadyLabel = provider.stripeConfigured
    ? dashboardInlineText(lang, 'ready_to_pay_7785f707')
    : dashboardInlineText(lang, 'demo_environment_d24b1a24');

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <div className="grid gap-4">
        <PageSynopsis
          lang={lang}
          title={dashboardInlineText(lang, 'billing_center_6b7cb102')}
          description={dashboardInlineText(
            lang,
            'start_with_the_current_plan_and_cost_then_review_7f86edcd'
          )}
          items={[
            {
              key: 'plan',
              label: dashboardInlineText(lang, 'current_plan_45e3ad53'),
              value: formatBillingPlan(lang, activePlan),
              tone: activePlan ? 'primary' : 'neutral',
            },
            {
              key: 'credits',
              label: dashboardInlineText(lang, 'credits_70d04d46'),
              value: String(snapshot.creditBalance.balance),
              tone: 'info',
            },
            {
              key: 'payment',
              label: dashboardInlineText(lang, 'payment_8c189583'),
              value: paymentReadyLabel,
              tone: provider.stripeConfigured ? 'success' : 'warning',
            },
            {
              key: 'invoices',
              label: dashboardInlineText(lang, 'billing_documents_a3d328b6'),
              value: String(invoices.length),
              tone: 'neutral',
            },
          ]}
        />

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <AdminPanel
            title={dashboardInlineText(lang, 'current_plan_45e3ad53')}
            description={dashboardInlineText(
              lang,
              'users_first_need_to_know_what_they_have_what_is__af154f49'
            )}
            action={
              checkoutSku ? (
                <form action="/api/billing/checkout" method="post">
                  <input type="hidden" name="sku" value={checkoutSku.id} />
                  <input
                    type="hidden"
                    name="next"
                    value={localizedPath(lang, '/dashboard/billing')}
                  />
                  <button type="submit" className={dashboardPrimaryButtonClass}>
                    {activePlan
                      ? dashboardInlineText(lang, 'manage_plan_3dafd87f')
                      : dashboardInlineText(lang, 'start_plan_b7964c9d')}
                  </button>
                </form>
              ) : null
            }
          >
            <div className="grid gap-4">
              <div className="rounded-admin-md border border-admin-primary/20 bg-admin-primary/10 p-4">
                <p className="text-sm font-semibold text-admin-primary">
                  {formatBillingPlan(lang, activePlan)}
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-admin-text">
                  {checkoutSku
                    ? formatMoneyAmount(lang, checkoutSku.amount, checkoutSku.currency)
                    : dashboardInlineText(lang, 'no_plan_selected_4a647345')}
                </h2>
                <p className="mt-2 text-sm leading-6 text-admin-text-muted">
                  {provider.stripeConfigured
                    ? dashboardInlineText(
                        lang,
                        'continue_to_checkout_orders_and_invoices_will_ap_f409b3d6'
                      )
                    : dashboardInlineText(
                        lang,
                        'this_open_source_demo_environment_does_not_charg_ae8ed90f'
                      )}
                </p>
              </div>
              {activeEntitlement ? (
                <UserRecordCard
                  lang={lang}
                  title={formatEntitlementLabel(lang, activeEntitlement.entitlement)}
                  description={formatBillingPlan(lang, activeEntitlement.planId)}
                  status={activeEntitlement.status}
                />
              ) : (
                <UserEmptyState
                  title={dashboardInlineText(lang, 'no_plan_access_yet_378471e2')}
                  body={dashboardInlineText(
                    lang,
                    'after_starting_a_plan_your_included_access_will__b1384780'
                  )}
                />
              )}
            </div>
          </AdminPanel>

          <AdminPanel
            title={dashboardInlineText(lang, 'billing_summary_b4243c3b')}
            description={dashboardInlineText(
              lang,
              'billing_details_work_better_as_a_summary_before__120a4515'
            )}
          >
            <FactList
              lang={lang}
              items={[
                {
                  label: dashboardInlineText(lang, 'payment_method_24c3775e'),
                  value: paymentMethods[0]
                    ? formatPaymentMethodLabel(
                        lang,
                        paymentMethods[0].label,
                        paymentMethods[0].provider
                      )
                    : dashboardInlineText(lang, 'not_saved_cff35d61'),
                },
                {
                  label: dashboardInlineText(lang, 'latest_invoice_a74cff15'),
                  value: invoices[0]?.number ?? dashboardInlineText(lang, 'none_yet_fab6c8d8'),
                },
                {
                  label: dashboardInlineText(lang, 'invoice_profile_36a4297f'),
                  value: profileText('company') || dashboardInlineText(lang, 'not_set_1e264983'),
                },
                {
                  label: dashboardInlineText(lang, 'orders_b34d55aa'),
                  value: String(snapshot.orders.length),
                },
              ]}
            />
          </AdminPanel>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <AdminPanel
            title={dashboardInlineText(lang, 'plans_776b71f3')}
            description={dashboardInlineText(
              lang,
              'plan_cards_should_show_only_what_users_need_to_d_d94069fd'
            )}
          >
            <div className="grid gap-3">
              {catalog.skus.map((sku) => (
                <UserRecordCard
                  key={sku.id}
                  lang={lang}
                  title={sku.name}
                  description={formatBillingPlan(lang, sku.planId)}
                  status={sku.status}
                  details={[
                    {
                      label: dashboardInlineText(lang, 'price_ef94daec'),
                      value: formatMoneyAmount(lang, sku.amount, sku.currency),
                    },
                    {
                      label: dashboardInlineText(lang, 'credits_80975d91'),
                      value: `${sku.credits} ${formatCreditUnit(lang, sku.creditUnit)}`,
                    },
                  ]}
                  actions={
                    <form action="/api/billing/checkout" method="post">
                      <input type="hidden" name="sku" value={sku.id} />
                      <input
                        type="hidden"
                        name="next"
                        value={localizedPath(lang, '/dashboard/billing')}
                      />
                      <button type="submit" className={dashboardGhostButtonClass}>
                        {dashboardInlineText(lang, 'select_700cb936')}
                      </button>
                    </form>
                  }
                />
              ))}
            </div>
          </AdminPanel>

          <AdminPanel
            title={dashboardInlineText(lang, 'invoices_and_receipts_10b7975e')}
            description={dashboardInlineText(
              lang,
              'users_may_need_these_for_reimbursement_refunds_o_6c6836dd'
            )}
          >
            {invoices.length > 0 ? (
              <div className="divide-y divide-admin-border rounded-admin-md border border-admin-border bg-admin-bg/40">
                {invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-admin-text">{invoice.number}</h3>
                        <FriendlyStatusBadge lang={lang} value={invoice.status} />
                      </div>
                      <p className="mt-1 text-sm text-admin-text-muted">
                        {formatUserDate(lang, invoice.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm font-semibold text-admin-text">
                        {formatMoneyAmount(lang, invoice.amount, invoice.currency)}
                      </span>
                      <ButtonLink href={invoice.hostedUrl} variant="secondary" size="small">
                        {dashboardInlineText(lang, 'view_document_27875c3d')}
                      </ButtonLink>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <UserEmptyState
                title={dashboardInlineText(lang, 'no_invoices_or_receipts_yet_153fe281')}
                body={dashboardInlineText(
                  lang,
                  'billing_documents_will_appear_here_after_a_purch_3d102256'
                )}
              />
            )}
          </AdminPanel>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <AdminPanel
            title={dashboardInlineText(lang, 'payment_methods_2db7ab78')}
            description={dashboardInlineText(
              lang,
              'show_payment_methods_in_language_users_recognize_5abbcd7a'
            )}
          >
            {paymentMethods.length > 0 ? (
              <div className="grid gap-3">
                {paymentMethods.map((method) => (
                  <UserRecordCard
                    key={method.id}
                    lang={lang}
                    title={formatPaymentMethodLabel(lang, method.label, method.provider)}
                    description={
                      method.brand ?? dashboardInlineText(lang, 'saved_payment_method_7abd12b6')
                    }
                    status={method.status}
                  />
                ))}
              </div>
            ) : (
              <UserEmptyState
                title={dashboardInlineText(lang, 'no_payment_method_yet_01d902be')}
                body={dashboardInlineText(
                  lang,
                  'payment_methods_will_appear_here_after_the_first_068e91d9'
                )}
              />
            )}
          </AdminPanel>

          <AdminPanel
            title={copy.taxProfile}
            description={dashboardInlineText(
              lang,
              'used_for_invoice_headers_and_tax_details_db146188'
            )}
          >
            <form action="/api/billing/tax-profile" method="post" className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label={copy.company} htmlFor="billing-company">
                  <Input
                    id="billing-company"
                    name="company"
                    defaultValue={profileText('company')}
                  />
                </FormField>
                <FormField
                  label={dashboardInlineText(lang, 'tax_id_f8871caf')}
                  htmlFor="billing-tax-id"
                >
                  <Input id="billing-tax-id" name="taxId" defaultValue={profileText('taxId')} />
                </FormField>
                <FormField
                  label={dashboardInlineText(lang, 'country_region_9439aec8')}
                  htmlFor="billing-country"
                >
                  <Input
                    id="billing-country"
                    name="country"
                    defaultValue={profileText('country')}
                  />
                </FormField>
              </div>
              <button type="submit" className={`${dashboardPrimaryButtonClass} w-fit`}>
                {copy.save}
              </button>
            </form>
          </AdminPanel>
        </section>
      </div>
    </WorkspaceShell>
  );
}

function DashboardOrdersOperationsPageV2({
  lang,
  snapshot,
}: {
  lang: SupportedLanguage;
  snapshot: UserSaasSnapshot;
}) {
  const copy = getDashboardCopy(lang).orders;
  const paidOrders = snapshot.orders.filter((order) => order.status === 'paid').length;
  const totalAmount = snapshot.orders.reduce((total, order) => total + order.amount, 0);
  const currency = snapshot.orders[0]?.currency ?? 'USD';

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <div className="grid gap-4">
        <PageSynopsis
          lang={lang}
          title={dashboardInlineText(lang, 'orders_7e89b24b')}
          description={dashboardInlineText(
            lang,
            'the_orders_page_should_start_as_a_purchase_histo_c1feea91'
          )}
          items={[
            {
              key: 'orders',
              label: dashboardInlineText(lang, 'orders_ca187bf2'),
              value: String(snapshot.orders.length),
              tone: 'primary',
            },
            {
              key: 'paid',
              label: dashboardInlineText(lang, 'completed_58782c56'),
              value: String(paidOrders),
              tone: 'success',
            },
            {
              key: 'amount',
              label: dashboardInlineText(lang, 'total_2c4e661e'),
              value:
                totalAmount === 0
                  ? dashboardInlineText(lang, 'free_demo_orders_d0fb6a4c')
                  : formatCurrencyMinor(totalAmount, currency, lang),
              tone: 'info',
            },
          ]}
        />

        <AdminPanel
          title={dashboardInlineText(lang, 'order_records_3a7874ee')}
          description={dashboardInlineText(
            lang,
            'a_chronological_list_for_checking_plan_amount_st_979cb88e'
          )}
          action={
            <ButtonLink
              href={localizedPath(lang, '/dashboard/billing')}
              variant="secondary"
              size="small"
            >
              {dashboardInlineText(lang, 'back_to_billing_93a176f0')}
            </ButtonLink>
          }
        >
          {snapshot.orders.length > 0 ? (
            <div className="overflow-hidden rounded-admin-md border border-admin-border bg-admin-bg/40">
              <div className="hidden grid-cols-[minmax(0,1.2fr)_0.8fr_0.8fr_0.8fr_auto] gap-3 border-b border-admin-border px-4 py-2 text-xs font-semibold uppercase text-admin-text-subtle md:grid">
                <span>{dashboardInlineText(lang, 'order_4e19c211')}</span>
                <span>{dashboardInlineText(lang, 'date_f14abad2')}</span>
                <span>{dashboardInlineText(lang, 'amount_a72e74a9')}</span>
                <span>{dashboardInlineText(lang, 'status_8042eaf1')}</span>
                <span className="text-right">{dashboardInlineText(lang, 'action_c3ce74b0')}</span>
              </div>
              <div className="divide-y divide-admin-border">
                {snapshot.orders.map((order) => (
                  <div
                    key={order.id}
                    className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.2fr)_0.8fr_0.8fr_0.8fr_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-admin-text">
                        {formatBillingSku(order.sku)}
                      </h3>
                      <p className="mt-1 text-xs text-admin-text-subtle">
                        {dashboardInlineText(lang, 'order_2702bd80')}{' '}
                        {order.id.slice(0, 8).toUpperCase()}
                      </p>
                    </div>
                    <span className="text-sm text-admin-text-muted">
                      {formatUserDate(lang, order.createdAt)}
                    </span>
                    <span className="text-sm font-semibold text-admin-text">
                      {formatOrderAmount(lang, order.amount, order.currency)}
                    </span>
                    <FriendlyStatusBadge lang={lang} value={order.status} />
                    <div className="flex justify-start md:justify-end">
                      <ButtonLink
                        href={`/api/billing/invoices?id=invoice-${order.id}`}
                        variant="secondary"
                        size="small"
                      >
                        {dashboardInlineText(lang, 'view_document_27875c3d')}
                      </ButtonLink>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <UserEmptyState
              title={dashboardInlineText(lang, 'no_orders_yet_b6d57cb8')}
              body={dashboardInlineText(
                lang,
                'after_checkout_your_purchase_records_and_payment_cbfd13fa'
              )}
              action={
                <ButtonLink
                  href={localizedPath(lang, '/dashboard/billing')}
                  variant="secondary"
                  size="small"
                >
                  {dashboardInlineText(lang, 'view_billing_3d3e1480')}
                </ButtonLink>
              }
            />
          )}
        </AdminPanel>
      </div>
    </WorkspaceShell>
  );
}

function DashboardCreditHistoryOperationsPageV2({
  lang,
  snapshot,
}: {
  lang: SupportedLanguage;
  snapshot: UserSaasSnapshot;
}) {
  const copy = getDashboardCopy(lang).credits;

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <div className="grid gap-4">
        <PageSynopsis
          lang={lang}
          title={dashboardInlineText(lang, 'credit_history_b29eb547')}
          description={dashboardInlineText(
            lang,
            'credit_history_works_better_as_a_transaction_lis_7860fec8'
          )}
          items={[
            {
              key: 'balance',
              label: dashboardInlineText(lang, 'balance_bf507738'),
              value: String(snapshot.creditBalance.balance),
              tone: 'primary',
            },
            {
              key: 'unit',
              label: dashboardInlineText(lang, 'unit_77c0cd5d'),
              value: formatCreditUnit(lang, snapshot.creditBalance.unit),
              tone: 'info',
            },
            {
              key: 'entries',
              label: dashboardInlineText(lang, 'entries_bd5b4b0f'),
              value: String(snapshot.credits.length),
              tone: 'neutral',
            },
          ]}
        />

        <AdminPanel
          title={dashboardInlineText(lang, 'transaction_list_8b388d42')}
          description={dashboardInlineText(
            lang,
            'each_row_explains_why_credits_increased_or_decre_168b5ef9'
          )}
        >
          {snapshot.credits.length > 0 ? (
            <div className="overflow-hidden rounded-admin-md border border-admin-border bg-admin-bg/40">
              <div className="hidden grid-cols-[minmax(0,1.3fr)_0.8fr_0.8fr_0.8fr] gap-3 border-b border-admin-border px-4 py-2 text-xs font-semibold uppercase text-admin-text-subtle md:grid">
                <span>{dashboardInlineText(lang, 'reason_0a7fcf20')}</span>
                <span>{dashboardInlineText(lang, 'date_15a1897e')}</span>
                <span>{dashboardInlineText(lang, 'change_7a8bae8a')}</span>
                <span>{dashboardInlineText(lang, 'status_8042eaf1')}</span>
              </div>
              <div className="divide-y divide-admin-border">
                {snapshot.credits.map((entry) => {
                  const positive = entry.amount > 0;
                  return (
                    <div
                      key={entry.id}
                      className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.3fr)_0.8fr_0.8fr_0.8fr] md:items-center"
                    >
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-admin-text">
                          {formatCreditReason(lang, entry.reason)}
                        </h3>
                        <p className="mt-1 text-xs text-admin-text-subtle">
                          {positive
                            ? dashboardInlineText(lang, 'credit_added_dd550da9')
                            : dashboardInlineText(lang, 'credit_used_f50377c3')}
                        </p>
                      </div>
                      <span className="text-sm text-admin-text-muted">
                        {formatUserDate(lang, entry.createdAt)}
                      </span>
                      <span
                        className={`text-sm font-semibold ${positive ? 'text-admin-success' : 'text-admin-text'}`}
                      >
                        {formatCreditAmount(lang, entry.amount, entry.unit)}
                      </span>
                      <FriendlyStatusBadge lang={lang} value={entry.status} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <UserEmptyState
              title={dashboardInlineText(lang, 'no_credit_history_yet_b7961cbd')}
              body={dashboardInlineText(
                lang,
                'when_you_earn_or_spend_credits_the_records_will__92ca66ab'
              )}
            />
          )}
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
      <PageSynopsis
        lang={lang}
        title={profile.displayName ?? profile.email}
        description={profile.email}
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
          { key: 'timezone', label: copy.timezone, value: profile.timezone ?? 'Asia/Hong_Kong' },
        ]}
      />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <AdminPanel
          title={dashboardInlineText(lang, 'account_overview_69c823ae')}
          description={dashboardInlineText(
            lang,
            'confirm_your_profile_and_current_team_access_8d24f20e'
          )}
        >
          <div className="mb-4 flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-admin-primary text-lg font-bold text-white dark:text-slate-950">
              {initials}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-admin-text">
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
              { label: copy.language, value: formatUserLanguage(lang, profile.language ?? lang) },
            ]}
          />
        </AdminPanel>

        <AdminPanel
          title={copy.basic}
          description={dashboardInlineText(
            lang,
            'update_your_display_name_avatar_language_and_tim_6e2ba993'
          )}
        >
          <form action={updateProfileAction} className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{copy.displayName}</span>
                <Input name="displayName" defaultValue={profile.displayName ?? ''} maxLength={80} />
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
            <button
              type="submit"
              className="inline-flex min-h-10 w-fit items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-950/10 transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50 dark:text-slate-950 dark:hover:bg-blue-300"
            >
              {copy.saveProfile}
            </button>
          </form>
        </AdminPanel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <AdminPanel title={copy.password} description={copy.changePasswordConfirm}>
          <form action={changePasswordAction} className="grid gap-4">
            <label className="grid gap-2 text-sm font-medium text-admin-text">
              <span>{copy.currentPassword}</span>
              <Input name="currentPassword" type="password" autoComplete="current-password" />
            </label>
            <label className="grid gap-2 text-sm font-medium text-admin-text">
              <span>{copy.newPassword}</span>
              <Input name="newPassword" type="password" minLength={8} autoComplete="new-password" />
            </label>
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-10 w-fit items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-950/10 transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50 dark:text-slate-950 dark:hover:bg-blue-300"
              confirmation={copy.changePasswordConfirm}
            >
              {copy.changePassword}
            </ConfirmSubmitButton>
          </form>
        </AdminPanel>

        <AdminPanel title={copy.notificationPrefs} description={copy.savePrefs}>
          <form action={updateNotificationPreferencesAction} className="grid gap-4">
            <Switch name="inApp" label={copy.inApp} defaultChecked={notifications.inApp} />
            <Switch name="email" label={copy.emailDelivery} defaultChecked={notifications.email} />
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
            <button
              type="submit"
              className="inline-flex min-h-10 w-fit items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-950/10 transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50 dark:text-slate-950 dark:hover:bg-blue-300"
            >
              {copy.savePrefs}
            </button>
          </form>
        </AdminPanel>
      </section>

      <AdminPanel
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
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text shadow-sm shadow-slate-950/5 transition hover:bg-admin-surface-muted"
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
    </WorkspaceShell>
  );
}

export function DashboardBillingOperationsPage({
  lang,
  overview,
}: {
  lang: SupportedLanguage;
  overview: HostBillingOverview;
}) {
  return <DashboardBillingOperationsPageV2 lang={lang} overview={overview} />;
  const copy = getDashboardCopy(lang).billing;
  const { snapshot, provider, invoices, paymentMethods, subscriptions, taxProfile, catalog } =
    overview;
  const profileText = (key: string) =>
    typeof taxProfile[key] === 'string' ? String(taxProfile[key]) : '';
  const checkoutSku = catalog.skus.find((sku) => sku.status !== 'archived') ?? catalog.skus[0];
  const activePlan = snapshot.entitlements[0]?.planId;
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <PageSynopsis
        lang={lang}
        title={dashboardInlineText(lang, 'billing_overview_a8ece2c0')}
        description={dashboardInlineText(
          lang,
          'start_here_for_your_plan_credits_payment_status__29a1a4ea'
        )}
        items={[
          {
            key: 'plan',
            label: dashboardInlineText(lang, 'plan_90212e66'),
            value: formatBillingPlan(lang, activePlan),
            tone: activePlan ? 'primary' : 'neutral',
          },
          {
            key: 'credits',
            label: dashboardInlineText(lang, 'credits_70d04d46'),
            value: String(snapshot.creditBalance.balance),
            tone: 'info',
          },
          {
            key: 'payment',
            label: dashboardInlineText(lang, 'payment_status_9273e5de'),
            value: provider.stripeConfigured
              ? dashboardInlineText(lang, 'ready_to_pay_59803c7a')
              : dashboardInlineText(lang, 'demo_environment_d24b1a24'),
            tone: provider.stripeConfigured ? 'success' : 'warning',
          },
          {
            key: 'invoices',
            label: dashboardInlineText(lang, 'invoices_8e533afa'),
            value: String(invoices.length),
            tone: 'neutral',
          },
        ]}
      />
      <form
        action="/api/billing/checkout"
        method="post"
        className="flex flex-col gap-4 rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card sm:flex-row sm:items-center sm:justify-between"
      >
        <input type="hidden" name="sku" value={checkoutSku?.id ?? ''} />
        <input type="hidden" name="next" value={localizedPath(lang, '/dashboard/billing')} />
        <div>
          <h2>{checkoutSku?.name ?? dashboardInlineText(lang, 'recommended_plan_60939eb2')}</h2>
          <p>
            {provider.stripeConfigured
              ? dashboardInlineText(lang, 'tap_to_continue_to_checkout_829bad97')
              : dashboardInlineText(
                  lang,
                  'this_demo_environment_will_create_a_demo_order_58061b92'
                )}
          </p>
        </div>
        <button type="submit" className={dashboardPrimaryButtonClass}>
          {dashboardInlineText(lang, 'continue_to_checkout_19d57b73')}
        </button>
      </form>
      <section className="grid gap-4 lg:grid-cols-2">
        <AdminPanel
          title={dashboardInlineText(lang, 'plans_776b71f3')}
          description={dashboardInlineText(
            lang,
            'choose_the_plan_that_fits_your_work_best_d8667c33'
          )}
        >
          <div className="grid gap-3">
            {catalog.skus.map((sku) => (
              <UserRecordCard
                key={sku.id}
                lang={lang}
                title={sku.name}
                description={formatBillingPlan(lang, sku.planId)}
                status={sku.status}
                details={[
                  {
                    label: dashboardInlineText(lang, 'price_7ab5917c'),
                    value: `${sku.amount} ${sku.currency}`,
                  },
                  {
                    label: dashboardInlineText(lang, 'credits_80975d91'),
                    value: `${sku.credits} ${formatCreditUnit(lang, sku.creditUnit)}`,
                  },
                ]}
                actions={
                  <form action="/api/billing/checkout" method="post">
                    <input type="hidden" name="sku" value={sku.id} />
                    <input
                      type="hidden"
                      name="next"
                      value={localizedPath(lang, '/dashboard/billing')}
                    />
                    <button type="submit" className={dashboardGhostButtonClass}>
                      {dashboardInlineText(lang, 'select_700cb936')}
                    </button>
                  </form>
                }
              />
            ))}
          </div>
        </AdminPanel>
        <AdminPanel
          title={dashboardInlineText(lang, 'invoices_8e533afa')}
          description={dashboardInlineText(lang, 'your_purchase_receipts_are_stored_here_badf2b7c')}
        >
          {invoices.length > 0 ? (
            <div className="grid gap-3">
              {invoices.map((invoice) => (
                <UserRecordCard
                  key={invoice.id}
                  lang={lang}
                  title={invoice.number}
                  description={formatOrderAmount(lang, invoice.amount, invoice.currency)}
                  meta={formatUserDate(lang, invoice.createdAt)}
                  status={invoice.status}
                  actions={
                    <ButtonLink href={invoice.hostedUrl} variant="secondary" size="small">
                      {dashboardInlineText(lang, 'view_invoice_2368af25')}
                    </ButtonLink>
                  }
                />
              ))}
            </div>
          ) : (
            <UserEmptyState
              title={dashboardInlineText(lang, 'no_invoices_yet_f96a650b')}
              body={dashboardInlineText(
                lang,
                'invoices_and_receipts_will_appear_here_after_you_84ff3091'
              )}
            />
          )}
        </AdminPanel>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <AdminPanel
          title={dashboardInlineText(lang, 'payment_methods_2db7ab78')}
          description={dashboardInlineText(lang, 'available_payment_methods_appear_here_8c74ec5c')}
        >
          {paymentMethods.length > 0 ? (
            <div className="grid gap-3">
              {paymentMethods.map((method) => (
                <UserRecordCard
                  key={method.id}
                  lang={lang}
                  title={formatPaymentMethodLabel(lang, method.label, method.provider)}
                  description={
                    method.brand ?? dashboardInlineText(lang, 'saved_payment_method_7abd12b6')
                  }
                  status={method.status}
                />
              ))}
            </div>
          ) : (
            <UserEmptyState
              title={dashboardInlineText(lang, 'no_payment_method_yet_01d902be')}
              body={dashboardInlineText(
                lang,
                'complete_a_purchase_first_and_a_payment_method_w_39b12350'
              )}
            />
          )}
        </AdminPanel>
        <AdminPanel
          title={copy.taxProfile}
          description={dashboardInlineText(
            lang,
            'used_for_invoice_headers_and_tax_details_db146188'
          )}
        >
          <form action="/api/billing/tax-profile" method="post" className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label={copy.company} htmlFor="billing-company">
                <Input id="billing-company" name="company" defaultValue={profileText('company')} />
              </FormField>
              <FormField
                label={dashboardInlineText(lang, 'tax_id_f8871caf')}
                htmlFor="billing-tax-id"
              >
                <Input id="billing-tax-id" name="taxId" defaultValue={profileText('taxId')} />
              </FormField>
              <FormField
                label={dashboardInlineText(lang, 'country_region_9439aec8')}
                htmlFor="billing-country"
              >
                <Input id="billing-country" name="country" defaultValue={profileText('country')} />
              </FormField>
            </div>
            <button type="submit" className={`${dashboardPrimaryButtonClass} w-fit`}>
              {copy.save}
            </button>
          </form>
        </AdminPanel>
      </section>
      <AdminPanel
        title={dashboardInlineText(lang, 'current_access_9d4a81f9')}
        description={dashboardInlineText(lang, 'what_your_plan_currently_includes_e42ab3ed')}
      >
        {snapshot.entitlements.length > 0 ? (
          <div className="grid gap-3">
            {snapshot.entitlements.map((item) => (
              <UserRecordCard
                key={item.id}
                lang={lang}
                title={formatEntitlementLabel(lang, item.entitlement)}
                description={formatBillingPlan(lang, item.planId)}
                status={item.status}
              />
            ))}
          </div>
        ) : (
          <UserEmptyState
            title={dashboardInlineText(lang, 'no_access_yet_27b8db9b')}
            body={dashboardInlineText(
              lang,
              'after_selecting_a_plan_the_features_you_can_use__0a7fe922'
            )}
          />
        )}
      </AdminPanel>
    </WorkspaceShell>
  );
}

export function DashboardOrdersOperationsPage({
  lang,
  snapshot,
}: {
  lang: SupportedLanguage;
  snapshot: UserSaasSnapshot;
}) {
  return <DashboardOrdersOperationsPageV2 lang={lang} snapshot={snapshot} />;
  const copy = getDashboardCopy(lang).orders;
  const paidOrders = snapshot.orders.filter((order) => order.status === 'paid').length;
  const totalAmount = snapshot.orders.reduce((total, order) => total + order.amount, 0);
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <PageSynopsis
        lang={lang}
        title={dashboardInlineText(lang, 'order_overview_b2ef192c')}
        description={dashboardInlineText(
          lang,
          'review_your_purchases_payment_status_and_receipt_825c9a22'
        )}
        items={[
          {
            key: 'orders',
            label: dashboardInlineText(lang, 'orders_ca187bf2'),
            value: String(snapshot.orders.length),
            tone: 'primary',
          },
          {
            key: 'paid',
            label: dashboardInlineText(lang, 'completed_58782c56'),
            value: String(paidOrders),
            tone: 'success',
          },
          {
            key: 'amount',
            label: dashboardInlineText(lang, 'total_8c3f738d'),
            value:
              totalAmount === 0
                ? dashboardInlineText(lang, 'free_demo_orders_d0fb6a4c')
                : formatCurrencyMinor(totalAmount, snapshot.orders[0]?.currency ?? 'USD', lang),
            tone: 'info',
          },
        ]}
      />
      <AdminPanel
        title={dashboardInlineText(lang, 'order_history_20834855')}
        description={dashboardInlineText(lang, 'each_order_can_be_opened_as_a_receipt_99d7fd4b')}
      >
        {snapshot.orders.length > 0 ? (
          <div className="grid gap-3">
            {snapshot.orders.map((order) => (
              <UserRecordCard
                key={order.id}
                lang={lang}
                title={formatBillingSku(order.sku)}
                description={formatOrderAmount(lang, order.amount, order.currency)}
                meta={formatUserDate(lang, order.updatedAt)}
                status={order.status}
                details={[
                  {
                    label: dashboardInlineText(lang, 'order_number_b3df9e95'),
                    value: order.id.slice(0, 8).toUpperCase(),
                  },
                  {
                    label: dashboardInlineText(lang, 'created_29b90579'),
                    value: formatUserDate(lang, order.createdAt),
                  },
                ]}
                actions={
                  <ButtonLink
                    href={`/api/billing/invoices?id=invoice-${order.id}`}
                    variant="secondary"
                    size="small"
                  >
                    {dashboardInlineText(lang, 'view_receipt_bcb84326')}
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
              'after_checkout_orders_payment_status_and_receipt_658e9a59'
            )}
            action={
              <ButtonLink
                href={localizedPath(lang, '/dashboard/billing')}
                variant="secondary"
                size="small"
              >
                {dashboardInlineText(lang, 'view_billing_3d3e1480')}
              </ButtonLink>
            }
          />
        )}
      </AdminPanel>
    </WorkspaceShell>
  );
}

export function DashboardFilesOperationsPage({
  lang,
  files,
  storage,
  quota,
  query,
}: {
  lang: SupportedLanguage;
  files: readonly RuntimeStoreFileRecord[];
  storage: HostFileStorageStatus;
  quota: HostFileQuotaStatus;
  query?: AdminTableQuery;
}) {
  const copy = getDashboardCopy(lang).files;
  const tableQuery = cleanTableQuery(query);
  const visibleFiles = files.filter(
    (file) =>
      matchesTextSearch(tableQuery.q, [
        file.id,
        file.name,
        file.moduleId,
        file.purpose,
        file.status,
        file.visibility,
        file.contentType ?? '',
      ]) && matchesExactFilter(tableQuery.status, file.status)
  );
  const quotaText = (used: number, limit: number) =>
    `${formatBytes(used, lang)} / ${formatBytes(limit, lang)}`;

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <PageSynopsis
        lang={lang}
        title={dashboardInlineText(lang, 'storage_usage_fc72a743')}
        description={dashboardInlineText(lang, 'upload_find_and_manage_your_files_c64a78cb')}
        items={[
          {
            key: 'storage',
            label: dashboardInlineText(lang, 'storage_3762c05e'),
            value: formatStorageLabel(lang, storage),
            detail: storage.durable
              ? dashboardInlineText(lang, 'ready_for_long_term_storage_f5b75477')
              : dashboardInlineText(lang, 'best_for_local_demos_f3c176e5'),
            tone: storage.durable ? 'success' : 'warning',
          },
          {
            key: 'files',
            label: dashboardInlineText(lang, 'files_de86c79a'),
            value: String(files.length),
            tone: 'primary',
          },
          {
            key: 'userQuota',
            label: dashboardInlineText(lang, 'your_usage_d3ec43c8'),
            value: quotaText(quota.userBytes, quota.perUserBytes),
            tone: 'info',
          },
          {
            key: 'workspaceQuota',
            label: dashboardInlineText(lang, 'workspace_usage_c45bf7ca'),
            value: quotaText(quota.workspaceBytes, quota.perWorkspaceBytes),
          },
        ]}
      />
      <AdminPanel
        title={copy.uploadFile}
        description={dashboardInlineText(
          lang,
          'choose_a_file_to_upload_to_the_current_workspace_6e5e1c96'
        )}
      >
        <form
          action="/api/files"
          method="post"
          encType="multipart/form-data"
          className="grid gap-4"
        >
          <input type="hidden" name="next" value={localizedPath(lang, '/dashboard/files')} />
          <input type="hidden" name="moduleId" value="web-shell" />
          <input type="hidden" name="purpose" value="source" />
          <label className="grid gap-3 rounded-admin-md border border-dashed border-admin-border bg-admin-bg/40 p-5 text-sm font-medium text-admin-text">
            <span className="text-base font-semibold">{copy.uploadFile}</span>
            <span className="text-sm font-normal leading-6 text-admin-text-muted">
              {dashboardInlineText(
                lang,
                'images_documents_and_data_files_are_supported_wi_eec501b6'
              )}
            </span>
            <input name="file" type="file" className="text-sm text-admin-text" />
          </label>
          <Button
            type="submit"
            className={`${dashboardPrimaryButtonClass} w-fit justify-self-start`}
          >
            {copy.upload}
          </Button>
        </form>
      </AdminPanel>
      <TableToolbar
        lang={lang}
        searchValue={tableQuery.q}
        searchPlaceholder={copy.searchPlaceholder}
        filterValue={tableQuery.status}
        filterOptions={getFileStatusOptions(lang)}
        resetHref={localizedPath(lang, '/dashboard/files')}
      />
      <FilterResultHint lang={lang} visible={visibleFiles.length} total={files.length} />
      <AdminPanel
        title={dashboardInlineText(lang, 'file_library_685c5c34')}
        description={dashboardInlineText(lang, 'uploaded_files_appear_here_625aa90e')}
      >
        {visibleFiles.length > 0 ? (
          <div className="grid gap-3">
            {visibleFiles.map((file) => (
              <UserRecordCard
                key={file.id}
                lang={lang}
                title={file.name}
                description={`${formatFilePurpose(lang, file.purpose)} · ${formatFileType(lang, file.contentType)}`}
                meta={formatUserDate(lang, file.updatedAt)}
                status={file.status}
                details={[
                  {
                    label: dashboardInlineText(lang, 'size_5354fe2d'),
                    value: formatBytes(file.sizeBytes, lang),
                  },
                  {
                    label: dashboardInlineText(lang, 'use_d8f25bd7'),
                    value: formatFilePurpose(lang, file.purpose),
                  },
                ]}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    {file.status === 'ready' || file.status === 'published' ? (
                      <>
                        <ButtonLink href={`/api/media/${file.id}`} variant="secondary" size="small">
                          {copy.open}
                        </ButtonLink>
                        <ButtonLink
                          href={`/api/media/${file.id}?download=1`}
                          variant="secondary"
                          size="small"
                        >
                          {copy.download}
                        </ButtonLink>
                      </>
                    ) : (
                      <span className="text-sm text-admin-text-muted">{copy.pending}</span>
                    )}
                    <form action={`/api/files/${file.id}`} method="post" className="inline-flex">
                      <input
                        type="hidden"
                        name="next"
                        value={localizedPath(lang, '/dashboard/files')}
                      />
                      <input type="hidden" name="action" value="archive" />
                      <ConfirmSubmitButton
                        type="submit"
                        className={dashboardGhostButtonClass}
                        disabled={file.status === 'archived' || file.status === 'deleted'}
                        confirmation={copy.archiveConfirm(file.name)}
                      >
                        {copy.archive}
                      </ConfirmSubmitButton>
                    </form>
                    <form action={`/api/files/${file.id}`} method="post" className="inline-flex">
                      <input
                        type="hidden"
                        name="next"
                        value={localizedPath(lang, '/dashboard/files')}
                      />
                      <input type="hidden" name="action" value="delete" />
                      <ConfirmSubmitButton
                        type="submit"
                        className={dashboardGhostButtonClass}
                        disabled={file.status === 'deleted'}
                        confirmation={copy.deleteConfirm(file.name)}
                      >
                        {copy.delete}
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                }
              />
            ))}
          </div>
        ) : (
          <UserEmptyState
            title={dashboardInlineText(lang, 'no_files_yet_e2696a7f')}
            body={dashboardInlineText(
              lang,
              'upload_your_first_file_to_open_download_or_delet_93337f23'
            )}
          />
        )}
      </AdminPanel>
    </WorkspaceShell>
  );
}

export function DashboardCreditHistoryOperationsPage({
  lang,
  snapshot,
}: {
  lang: SupportedLanguage;
  snapshot: UserSaasSnapshot;
}) {
  return <DashboardCreditHistoryOperationsPageV2 lang={lang} snapshot={snapshot} />;
  const copy = getDashboardCopy(lang).credits;
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <PageSynopsis
        lang={lang}
        title={dashboardInlineText(lang, 'credit_overview_9159b084')}
        description={dashboardInlineText(
          lang,
          'see_your_available_credits_and_recent_changes_0519a627'
        )}
        items={[
          {
            key: 'balance',
            label: dashboardInlineText(lang, 'balance_bf507738'),
            value: String(snapshot.creditBalance.balance),
            tone: 'primary',
          },
          {
            key: 'unit',
            label: dashboardInlineText(lang, 'unit_77c0cd5d'),
            value: formatCreditUnit(lang, snapshot.creditBalance.unit),
            tone: 'info',
          },
          {
            key: 'entries',
            label: dashboardInlineText(lang, 'entries_bd5b4b0f'),
            value: String(snapshot.credits.length),
            tone: 'warning',
          },
        ]}
      />
      <AdminPanel
        title={dashboardInlineText(lang, 'credit_history_8696bc5d')}
        description={dashboardInlineText(lang, 'each_record_explains_why_credits_changed_e8a57e3a')}
      >
        {snapshot.credits.length > 0 ? (
          <div className="grid gap-3">
            {snapshot.credits.map((entry) => (
              <UserRecordCard
                key={entry.id}
                lang={lang}
                title={formatCreditReason(lang, entry.reason)}
                description={formatCreditAmount(lang, entry.amount, entry.unit)}
                meta={formatUserDate(lang, entry.createdAt)}
                status={entry.status}
                details={[
                  {
                    label: dashboardInlineText(lang, 'change_7a8bae8a'),
                    value: formatCreditAmount(lang, entry.amount, entry.unit),
                  },
                  {
                    label: dashboardInlineText(lang, 'outcome_5f3d51d2'),
                    value: friendlyStatusLabel(lang, entry.status),
                  },
                ]}
              />
            ))}
          </div>
        ) : (
          <UserEmptyState
            title={dashboardInlineText(lang, 'no_credit_history_yet_b7961cbd')}
            body={dashboardInlineText(
              lang,
              'when_you_earn_or_spend_credits_the_records_will__92ca66ab'
            )}
          />
        )}
      </AdminPanel>
    </WorkspaceShell>
  );
}

export function DashboardTasksOperationsPage({
  lang,
  snapshot,
}: {
  lang: SupportedLanguage;
  snapshot: UserSaasSnapshot;
}) {
  const copy = getDashboardCopy(lang).tasks;
  const runningCount = snapshot.tasks.filter(
    (run) => run.status === 'running' || run.status === 'queued'
  ).length;
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <PageSynopsis
        lang={lang}
        title={dashboardInlineText(lang, 'task_overview_b409cf6f')}
        description={dashboardInlineText(
          lang,
          'track_task_progress_results_and_issues_that_need_dfd8d4b6'
        )}
        items={[
          {
            key: 'tasks',
            label: dashboardInlineText(lang, 'tasks_9350ae8a'),
            value: String(snapshot.tasks.length),
            tone: 'primary',
          },
          {
            key: 'running',
            label: dashboardInlineText(lang, 'running_9a4f6603'),
            value: String(runningCount),
            tone: 'warning',
          },
          {
            key: 'succeeded',
            label: dashboardInlineText(lang, 'completed_58782c56'),
            value: String(snapshot.tasks.filter((run) => run.status === 'succeeded').length),
            tone: 'success',
          },
        ]}
      />
      <AdminPanel
        title={dashboardInlineText(lang, 'tasks_7e53ff19')}
        description={dashboardInlineText(
          lang,
          'recent_tasks_include_progress_and_result_links_3e251507'
        )}
      >
        {snapshot.tasks.length > 0 ? (
          <div className="grid gap-3">
            {snapshot.tasks.map((run) => (
              <UserRecordCard
                key={run.id}
                lang={lang}
                title={formatTaskName(lang, run.name)}
                description={
                  <div className="grid gap-2">
                    <span>{progressDescription(lang, run.progress)}</span>
                    <ProgressBar value={run.progress} />
                  </div>
                }
                meta={formatUserDate(lang, run.updatedAt)}
                status={run.status}
                details={[
                  {
                    label: dashboardInlineText(lang, 'started_da6afcd5'),
                    value: formatUserDate(lang, run.startedAt ?? run.createdAt),
                  },
                  {
                    label: dashboardInlineText(lang, 'updated_8505907f'),
                    value: formatUserDate(lang, run.updatedAt),
                  },
                ]}
                actions={
                  <ButtonLink
                    href={localizedPath(lang, `/dashboard/tasks/${run.id}`)}
                    variant="secondary"
                    size="small"
                  >
                    {run.status === 'succeeded'
                      ? dashboardInlineText(lang, 'view_result_b5449146')
                      : dashboardInlineText(lang, 'view_progress_c9794340')}
                  </ButtonLink>
                }
              />
            ))}
          </div>
        ) : (
          <UserEmptyState
            title={dashboardInlineText(lang, 'no_tasks_yet_80f8a083')}
            body={dashboardInlineText(
              lang,
              'exports_uploads_and_background_work_will_appear__a4286eeb'
            )}
          />
        )}
      </AdminPanel>
    </WorkspaceShell>
  );
}

export function DashboardTaskDetailOperationsPage({
  lang,
  run,
}: {
  lang: SupportedLanguage;
  run: UserSaasSnapshot['tasks'][number] | null;
}) {
  const copy = getDashboardCopy(lang).taskDetail;
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      {run ? (
        <div className="grid gap-4">
          <PageSynopsis
            lang={lang}
            title={formatTaskName(lang, run.name)}
            description={dashboardInlineText(lang, 'task_progress_and_result_12bd2a9d')}
            status={run.status}
            statusTone={
              run.status === 'succeeded'
                ? 'success'
                : run.status === 'failed'
                  ? 'danger'
                  : 'warning'
            }
            items={[
              {
                key: 'progress',
                label: dashboardInlineText(lang, 'progress_3b8bb103'),
                value: `${run.progress}%`,
                tone: 'primary',
              },
              {
                key: 'attempts',
                label: dashboardInlineText(lang, 'attempts_aace9c74'),
                value: String(run.attempt),
                tone: 'warning',
              },
              {
                key: 'time',
                label: dashboardInlineText(lang, 'started_da6afcd5'),
                value: formatUserDate(lang, run.startedAt ?? run.createdAt),
              },
            ]}
          />
          <AdminPanel
            title={dashboardInlineText(lang, 'result_summary_da691b87')}
            description={dashboardInlineText(
              lang,
              'start_with_the_readable_result_before_deciding_w_d29badc5'
            )}
          >
            <FactList
              lang={lang}
              items={[
                {
                  key: 'status',
                  label: dashboardInlineText(lang, 'status_e92c46a3'),
                  value: friendlyStatusLabel(lang, run.status),
                },
                {
                  key: 'progress',
                  label: dashboardInlineText(lang, 'progress_f5502dfa'),
                  value: `${run.progress}%`,
                },
                {
                  key: 'startedAt',
                  label: dashboardInlineText(lang, 'started_da6afcd5'),
                  value: formatUserDate(lang, run.startedAt ?? run.createdAt),
                },
                {
                  key: 'completedAt',
                  label: dashboardInlineText(lang, 'completed_a258863b'),
                  value: formatUserDate(lang, run.completedAt),
                },
                {
                  key: 'result',
                  label: dashboardInlineText(lang, 'result_df9aef04'),
                  value: formatTaskResult(lang, run.result),
                },
              ]}
            />
          </AdminPanel>
          <AdminPanel
            title={dashboardInlineText(lang, 'next_step_aa0a86ed')}
            description={dashboardInlineText(
              lang,
              'if_this_did_not_finish_as_expected_go_back_to_th_5ee65668'
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <ButtonLink
                href={localizedPath(lang, '/dashboard/tasks')}
                variant="secondary"
                size="small"
              >
                {dashboardInlineText(lang, 'back_to_tasks_d9330c75')}
              </ButtonLink>
              {run.status === 'failed' ? (
                <span className="text-sm text-admin-text-muted">
                  {dashboardInlineText(lang, 'check_the_input_and_run_the_task_again_17e98402')}
                </span>
              ) : null}
            </div>
          </AdminPanel>
        </div>
      ) : (
        <UserEmptyState
          title={copy.missingTitle}
          body={dashboardInlineText(
            lang,
            'this_task_may_have_expired_been_cleaned_up_or_is_2e94d139'
          )}
          action={
            <ButtonLink
              href={localizedPath(lang, '/dashboard/tasks')}
              variant="secondary"
              size="small"
            >
              {dashboardInlineText(lang, 'back_to_tasks_d9330c75')}
            </ButtonLink>
          }
        />
      )}
    </WorkspaceShell>
  );
}

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

function StatusBadge({ lang, value }: { lang: SupportedLanguage; value: string }) {
  return <AdminStatusBadge lang={lang} value={value} />;
}

function cleanTableQuery(query?: AdminTableQuery): Required<AdminTableQuery> {
  return {
    q: query?.q?.trim() ?? '',
    status: query?.status?.trim() ?? '',
    role: query?.role?.trim() ?? '',
    type: query?.type?.trim() ?? '',
    moduleId: query?.moduleId?.trim() ?? '',
    service: query?.service?.trim() ?? '',
    workspace: query?.workspace?.trim() ?? '',
    environment: query?.environment?.trim() ?? '',
    range: query?.range?.trim() ?? '',
    from: query?.from?.trim() ?? '',
    to: query?.to?.trim() ?? '',
    owner: query?.owner?.trim() ?? '',
    mime: query?.mime?.trim() ?? '',
    provider: query?.provider?.trim() ?? '',
    path: query?.path?.trim() ?? '',
    minSize: query?.minSize ?? 0,
    maxSize: query?.maxSize ?? 0,
    page: query?.page ?? 1,
    pageSize: query?.pageSize ?? 20,
    operation: query?.operation?.trim() ?? '',
    outcome: query?.outcome?.trim() ?? '',
    matched: query?.matched ?? 0,
    processed: query?.processed ?? 0,
    failed: query?.failed ?? 0,
    skipped: query?.skipped ?? 0,
    deadLettered: query?.deadLettered ?? 0,
  };
}

function matchesTextSearch(query: string, values: readonly unknown[]): boolean {
  if (query.length === 0) {
    return true;
  }
  const needle = query.toLowerCase();
  return values.some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(needle)
  );
}

function matchesExactFilter(filter: string, value: unknown): boolean {
  return filter.length === 0 || String(value ?? '') === filter;
}

function FilterResultHint({
  lang,
  visible,
  total,
}: {
  lang: SupportedLanguage;
  visible: number;
  total: number;
}) {
  if (visible === total) {
    return null;
  }
  const copy = getDashboardCopy(lang).common;
  return <p className="text-sm text-admin-text-muted">{copy.filterResult(visible, total)}</p>;
}

function getFileStatusOptions(lang: SupportedLanguage) {
  return [
    { value: 'pending', label: friendlyStatusLabel(lang, 'pending') },
    { value: 'uploading', label: friendlyStatusLabel(lang, 'uploading') },
    { value: 'ready', label: friendlyStatusLabel(lang, 'ready') },
    { value: 'published', label: friendlyStatusLabel(lang, 'published') },
    { value: 'archived', label: friendlyStatusLabel(lang, 'archived') },
    { value: 'deleted', label: friendlyStatusLabel(lang, 'deleted') },
    { value: 'quarantined', label: friendlyStatusLabel(lang, 'quarantined') },
  ] as const;
}

import { WorkspaceShell } from '@host/components/ProductShell';
import { PageSynopsis } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import {
  UserSectionNav,
  formatWorkspaceDisplayName,
} from './DashboardPageUtils';
import { WorkspaceAccessSection } from './WorkspaceAccessSection';
import { WorkspaceCollaborationSection } from './WorkspaceCollaborationSection';
import { WorkspaceListSection } from './WorkspaceListSection';
import type {
  AdminFormAction,
  ProductScopeDomainAlias,
  ProductScopeInvite,
  ProductScopeMemberRow,
  ProductScopePageScope,
} from './WorkspacesPageModel';

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
  const copy = getDashboardCopy(lang).workspaces;
  const currentWorkspaceId = scope.workspace?.id ?? '';
  const currentProductId = scope.product?.id ?? scope.products[0]?.id ?? '';
  const currentWorkspaceName = scope.workspace
    ? formatWorkspaceDisplayName(lang, scope.workspace.name)
    : dashboardInlineText(lang, 'no_workspace_selected_862a3762');
  const pendingInvitations = invitations.filter((invite) => invite.status === 'pending').length;

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

        <WorkspaceListSection
          lang={lang}
          scope={scope}
          currentProductId={currentProductId}
          currentWorkspaceId={currentWorkspaceId}
          switchWorkspaceAction={switchWorkspaceAction}
          createWorkspaceAction={createWorkspaceAction}
        />
        <WorkspaceCollaborationSection
          lang={lang}
          currentWorkspaceId={currentWorkspaceId}
          currentWorkspaceName={currentWorkspaceName}
          members={members}
          invitations={invitations}
          createInvitationAction={createInvitationAction}
          updateInvitationAction={updateInvitationAction}
        />
        <WorkspaceAccessSection
          lang={lang}
          currentProductId={currentProductId}
          currentWorkspaceId={currentWorkspaceId}
          currentWorkspaceName={currentWorkspaceName}
          workspaces={scope.workspaces}
          aliases={aliases}
          upsertDomainAliasAction={upsertDomainAliasAction}
        />
      </div>
    </WorkspaceShell>
  );
}

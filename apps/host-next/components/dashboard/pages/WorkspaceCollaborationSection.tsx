import { ConfirmSubmitButton, Input, Select } from '@host/components/ui';
import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import {
  UserEmptyState,
  UserHashPanel,
  UserRecordCard,
  dashboardGhostButtonClass,
  dashboardPrimaryButtonClass,
  formatUserDate,
  formatUserRole,
} from './DashboardPageUtils';
import type { AdminFormAction, ProductScopeInvite, ProductScopeMemberRow } from './WorkspacesPageModel';

export function WorkspaceCollaborationSection({
  lang,
  currentWorkspaceId,
  currentWorkspaceName,
  members,
  invitations,
  createInvitationAction,
  updateInvitationAction,
}: {
  lang: SupportedLanguage;
  currentWorkspaceId: string;
  currentWorkspaceName: string;
  members: ProductScopeMemberRow[];
  invitations: ProductScopeInvite[];
  createInvitationAction: AdminFormAction;
  updateInvitationAction: AdminFormAction;
}) {
  const copy = getDashboardCopy(lang).workspaces;

  return (
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
  );
}

import { Input } from '@host/components/ui';
import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import {
  UserHashPanel,
  UserRecordCard,
  dashboardGhostButtonClass,
  dashboardPrimaryButtonClass,
  formatWorkspaceDisplayName,
} from './DashboardPageUtils';
import type { AdminFormAction, ProductScopePageScope } from './WorkspacesPageModel';

export function WorkspaceListSection({
  lang,
  scope,
  currentProductId,
  currentWorkspaceId,
  switchWorkspaceAction,
  createWorkspaceAction,
}: {
  lang: SupportedLanguage;
  scope: ProductScopePageScope;
  currentProductId: string;
  currentWorkspaceId: string;
  switchWorkspaceAction: AdminFormAction;
  createWorkspaceAction: AdminFormAction;
}) {
  const copy = getDashboardCopy(lang).workspaces;

  return (
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
                  : dashboardInlineText(lang, 'switch_to_manage_its_members_and_settings_a414caa7')
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
  );
}

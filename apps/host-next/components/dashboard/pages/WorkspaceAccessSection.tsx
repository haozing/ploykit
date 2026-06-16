import { Input } from '@host/components/ui';
import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import {
  UserEmptyState,
  UserHashPanel,
  UserRecordCard,
  dashboardPrimaryButtonClass,
  formatProductLabel,
  formatWorkspaceDisplayName,
} from './DashboardPageUtils';
import type {
  AdminFormAction,
  ProductScopeDomainAlias,
  ProductScopeWorkspace,
} from './WorkspacesPageModel';

export function WorkspaceAccessSection({
  lang,
  currentProductId,
  currentWorkspaceId,
  currentWorkspaceName,
  workspaces,
  aliases,
  upsertDomainAliasAction,
}: {
  lang: SupportedLanguage;
  currentProductId: string;
  currentWorkspaceId: string;
  currentWorkspaceName: string;
  workspaces: ProductScopeWorkspace[];
  aliases: ProductScopeDomainAlias[];
  upsertDomainAliasAction: AdminFormAction;
}) {
  const copy = getDashboardCopy(lang).workspaces;
  const workspaceNameById = new Map(
    workspaces.map((workspace) => [
      workspace.id,
      formatWorkspaceDisplayName(lang, workspace.name),
    ])
  );

  return (
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
  );
}

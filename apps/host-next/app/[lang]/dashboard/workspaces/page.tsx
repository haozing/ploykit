import { redirect } from 'next/navigation';
import { DashboardWorkspacesOperationsPage } from '@host/components/dashboard/DashboardPages';
import { generatePresentedHostMetadata } from '@host/lib/host-page-rendering';
import { renderPresentedHostPage } from '@host/lib/host-page-rendering';
import { localizedPath } from '@host/lib/i18n';
import {
  createProductScopeWorkspace,
  createWorkspaceInvitation,
  getCurrentProductScope,
  listProductScopeDomainAliases,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  switchCurrentWorkspace,
  updateWorkspaceInvitation,
  upsertProductScopeDomainAlias,
} from '@host/lib/product-scope-api';
import {
  requireUserActionContext,
  revalidateLocalizedPaths,
} from '@host/lib/request-context';
import {
  readLanguageAndRequireUser,
  readLanguageParam,
  type LanguageRouteParams,
} from '@host/lib/route-params';

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`WORKSPACE_FORM_FIELD_REQUIRED: ${name}`);
  }
  return value.trim();
}

function readOptionalFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function createWorkspaceSlug(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || `workspace-${Date.now().toString(36)}`;
}

function readWorkspaceRole(formData: FormData) {
  const role = readRequiredFormString(formData, 'role');
  if (role === 'owner' || role === 'admin' || role === 'editor' || role === 'viewer') {
    return role;
  }
  throw new Error(`WORKSPACE_ROLE_UNSUPPORTED: ${role}`);
}

function readInviteAction(formData: FormData) {
  const action = readRequiredFormString(formData, 'action');
  if (action === 'accept' || action === 'revoke' || action === 'expire') {
    return action;
  }
  throw new Error(`INVITE_ACTION_UNSUPPORTED: ${action}`);
}

async function switchWorkspaceAction(formData: FormData) {
  'use server';

  const { lang, session } = await requireUserActionContext('/dashboard/workspaces');
  await switchCurrentWorkspace(session, readRequiredFormString(formData, 'workspaceId'));
  revalidateLocalizedPaths(lang, [
    '/dashboard',
    '/dashboard/workspaces',
    '/dashboard/files',
    '/dashboard/billing',
  ]);
  redirect(localizedPath(lang, '/dashboard/workspaces'));
}

async function createWorkspaceAction(formData: FormData) {
  'use server';

  const { lang, session } = await requireUserActionContext('/dashboard/workspaces');
  const name = readRequiredFormString(formData, 'name');
  await createProductScopeWorkspace(session, {
    productId: readRequiredFormString(formData, 'productId'),
    name,
    slug: readOptionalFormString(formData, 'slug') || createWorkspaceSlug(name),
  });
  revalidateLocalizedPaths(lang, [
    '/dashboard',
    '/dashboard/workspaces',
    '/dashboard/files',
    '/dashboard/billing',
  ]);
  redirect(localizedPath(lang, '/dashboard/workspaces'));
}

async function createInvitationAction(formData: FormData) {
  'use server';

  const { lang, session } = await requireUserActionContext('/dashboard/workspaces');
  await createWorkspaceInvitation(session, readRequiredFormString(formData, 'workspaceId'), {
    email: readRequiredFormString(formData, 'email'),
    role: readWorkspaceRole(formData),
  });
  revalidateLocalizedPaths(lang, [
    '/dashboard',
    '/dashboard/workspaces',
    '/dashboard/files',
    '/dashboard/billing',
  ]);
  redirect(localizedPath(lang, '/dashboard/workspaces'));
}

async function updateInvitationAction(formData: FormData) {
  'use server';

  const { lang, session } = await requireUserActionContext('/dashboard/workspaces');
  await updateWorkspaceInvitation(session, readRequiredFormString(formData, 'workspaceId'), {
    token: readRequiredFormString(formData, 'token'),
    action: readInviteAction(formData),
  });
  revalidateLocalizedPaths(lang, [
    '/dashboard',
    '/dashboard/workspaces',
    '/dashboard/files',
    '/dashboard/billing',
  ]);
  redirect(localizedPath(lang, '/dashboard/workspaces'));
}

async function upsertDomainAliasAction(formData: FormData) {
  'use server';

  const { lang, session } = await requireUserActionContext('/dashboard/workspaces');
  await upsertProductScopeDomainAlias(session, {
    hostname: readRequiredFormString(formData, 'hostname'),
    productId: readRequiredFormString(formData, 'productId'),
    workspaceId: readRequiredFormString(formData, 'workspaceId'),
  });
  revalidateLocalizedPaths(lang, [
    '/dashboard',
    '/dashboard/workspaces',
    '/dashboard/files',
    '/dashboard/billing',
  ]);
  redirect(localizedPath(lang, '/dashboard/workspaces'));
}

export default async function DashboardWorkspacesPage({
  params,
}: {
  params: Promise<LanguageRouteParams>;
}) {
  const [lang, session] = await readLanguageAndRequireUser(params, '/dashboard/workspaces');
  const scope = await getCurrentProductScope(session);
  const workspaceId = scope.workspace?.id ?? session.workspaceId;
  const [members, invitations, aliases] = await Promise.all([
    workspaceId ? listWorkspaceMembers(session, workspaceId).catch(() => []) : [],
    workspaceId ? listWorkspaceInvitations(session, workspaceId).catch(() => []) : [],
    listProductScopeDomainAliases(session).catch(() => []),
  ]);

  return renderPresentedHostPage({
    pageId: 'dashboard.workspaces',
    defaultPage: (
      <DashboardWorkspacesOperationsPage
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
    ),
    lang,
    session,
    workspaceId: session.workspaceId,
  });
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({
    pageId: 'dashboard.workspaces',
    lang,
  });
}

import {
  apiError,
  apiOk,
  readJsonObject,
  requireApiSession,
  stringBody,
} from '@host/lib/api';
import {
  createWorkspaceInvitation,
  listWorkspaceInvitations,
  updateWorkspaceInvitation,
} from '@host/lib/product-scope-api';

interface WorkspaceInvitationsContext {
  params: Promise<{ workspaceId: string }>;
}

function readWorkspaceRole(value: string | undefined) {
  if (value === 'owner' || value === 'admin' || value === 'editor' || value === 'viewer') {
    return value;
  }
  throw new Error(`WORKSPACE_ROLE_UNSUPPORTED:${value ?? 'missing'}`);
}

function readInviteAction(value: string | undefined) {
  if (value === 'accept' || value === 'revoke' || value === 'expire') {
    return value;
  }
  throw new Error(`INVITE_ACTION_UNSUPPORTED:${value ?? 'missing'}`);
}

export async function GET(request: Request, context: WorkspaceInvitationsContext) {
  const resolved = await requireApiSession(request, 'productScope.invitations');
  if (resolved instanceof Response) {
    return resolved;
  }
  const { workspaceId } = await context.params;
  try {
    return apiOk({ invitations: await listWorkspaceInvitations(resolved.session, workspaceId) });
  } catch (error) {
    return apiError(403, 'WORKSPACE_INVITES_FORBIDDEN', 'Unable to list invitations.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function POST(request: Request, context: WorkspaceInvitationsContext) {
  const resolved = await requireApiSession(request, 'productScope.invitations');
  if (resolved instanceof Response) {
    return resolved;
  }
  const { workspaceId } = await context.params;
  const body = await readJsonObject(request);
  try {
    const invitation = await createWorkspaceInvitation(resolved.session, workspaceId, {
      email: stringBody(body, 'email', { required: true }) ?? '',
      role: readWorkspaceRole(stringBody(body, 'role', { required: true })),
    });
    return apiOk({ invitation });
  } catch (error) {
    return apiError(400, 'WORKSPACE_INVITE_CREATE_FAILED', 'Unable to create invitation.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function PATCH(request: Request, context: WorkspaceInvitationsContext) {
  const resolved = await requireApiSession(request, 'productScope.invitations');
  if (resolved instanceof Response) {
    return resolved;
  }
  const { workspaceId } = await context.params;
  const body = await readJsonObject(request);
  try {
    const invitation = await updateWorkspaceInvitation(resolved.session, workspaceId, {
      token: stringBody(body, 'token', { required: true }) ?? '',
      action: readInviteAction(stringBody(body, 'action', { required: true })),
    });
    return apiOk({ invitation });
  } catch (error) {
    return apiError(400, 'WORKSPACE_INVITE_UPDATE_FAILED', 'Unable to update invitation.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

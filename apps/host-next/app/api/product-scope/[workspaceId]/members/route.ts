import {
  apiError,
  apiOk,
  readJsonObject,
  requireApiSession,
  stringBody,
} from '@host/lib/api';
import {
  listWorkspaceMembers,
  upsertWorkspaceMember,
} from '@host/lib/product-scope-api';

interface WorkspaceMembersContext {
  params: Promise<{ workspaceId: string }>;
}

function readWorkspaceRole(value: string | undefined) {
  if (value === 'owner' || value === 'admin' || value === 'editor' || value === 'viewer') {
    return value;
  }
  throw new Error(`WORKSPACE_ROLE_UNSUPPORTED:${value ?? 'missing'}`);
}

export async function GET(request: Request, context: WorkspaceMembersContext) {
  const resolved = await requireApiSession(request, 'productScope.members');
  if (resolved instanceof Response) {
    return resolved;
  }
  const { workspaceId } = await context.params;
  try {
    return apiOk({ members: await listWorkspaceMembers(resolved.session, workspaceId) });
  } catch (error) {
    return apiError(403, 'WORKSPACE_MEMBERS_FORBIDDEN', 'Unable to list workspace members.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function POST(request: Request, context: WorkspaceMembersContext) {
  const resolved = await requireApiSession(request, 'productScope.members');
  if (resolved instanceof Response) {
    return resolved;
  }
  const { workspaceId } = await context.params;
  const body = await readJsonObject(request);
  try {
    const member = await upsertWorkspaceMember(resolved.session, workspaceId, {
      userId: stringBody(body, 'userId', { required: true }) ?? '',
      role: readWorkspaceRole(stringBody(body, 'role', { required: true })),
      status: body.status === 'disabled' ? 'disabled' : 'active',
    });
    return apiOk({ member });
  } catch (error) {
    return apiError(400, 'WORKSPACE_MEMBER_UPDATE_FAILED', 'Unable to update member.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

import {
  apiError,
  apiOk,
  readJsonObject,
  requireApiSession,
  stringBody,
} from '@host/lib/api';
import { switchCurrentWorkspace } from '@host/lib/product-scope-api';

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'productScope.switch');
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  try {
    const workspaceId = stringBody(body, 'workspaceId', { required: true }) ?? '';
    return apiOk({ scope: await switchCurrentWorkspace(resolved.session, workspaceId) });
  } catch (error) {
    return apiError(400, 'WORKSPACE_SWITCH_FAILED', 'Unable to switch workspace.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

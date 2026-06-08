import {
  apiError,
  apiOk,
  readJsonObject,
  requireApiSession,
  stringBody,
} from '@host/lib/api';
import { createProductScopeCookie } from '@host/lib/product-scope';
import { switchCurrentWorkspace } from '@host/lib/product-scope-api';

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'productScope.switch');
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  try {
    const workspaceId = stringBody(body, 'workspaceId', { required: true }) ?? '';
    const scope = await switchCurrentWorkspace(resolved.session, workspaceId);
    const productId = scope.product?.id ?? resolved.session.productId;
    const selectedWorkspaceId = scope.workspace?.id ?? workspaceId;
    if (!productId || !selectedWorkspaceId) {
      throw new Error('WORKSPACE_SWITCH_SCOPE_INVALID');
    }
    return apiOk(
      { scope },
      {
        headers: {
          'Set-Cookie': createProductScopeCookie({
            productId,
            workspaceId: selectedWorkspaceId,
          }),
        },
      }
    );
  } catch (error) {
    return apiError(400, 'WORKSPACE_SWITCH_FAILED', 'Unable to switch workspace.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

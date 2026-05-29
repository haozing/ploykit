import {
  apiError,
  apiOk,
  readJsonObject,
  requireApiSession,
  stringBody,
} from '@host/lib/api';
import {
  createProductScopeWorkspace,
  listProductScopeWorkspaces,
} from '@host/lib/product-scope-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'productScope.workspaces');
  if (resolved instanceof Response) {
    return resolved;
  }
  const productId = new URL(request.url).searchParams.get('productId') ?? undefined;
  return apiOk({ workspaces: await listProductScopeWorkspaces(resolved.session, productId) });
}

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'productScope.workspaces');
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  try {
    const workspace = await createProductScopeWorkspace(resolved.session, {
      productId: stringBody(body, 'productId', { required: true }) ?? '',
      name: stringBody(body, 'name', { required: true, maxLength: 80 }) ?? '',
      slug: stringBody(body, 'slug', { required: true, maxLength: 48 }) ?? '',
    });
    return apiOk({ workspace });
  } catch (error) {
    return apiError(400, 'WORKSPACE_CREATE_FAILED', 'Unable to create workspace.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

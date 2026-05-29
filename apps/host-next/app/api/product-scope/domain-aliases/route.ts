import {
  apiError,
  apiOk,
  readJsonObject,
  requireApiSession,
  stringBody,
} from '@host/lib/api';
import {
  listProductScopeDomainAliases,
  upsertProductScopeDomainAlias,
} from '@host/lib/product-scope-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'productScope.domainAliases');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ aliases: await listProductScopeDomainAliases(resolved.session) });
}

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'productScope.domainAliases');
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  try {
    const alias = await upsertProductScopeDomainAlias(resolved.session, {
      hostname: stringBody(body, 'hostname', { required: true, maxLength: 120 }) ?? '',
      productId: stringBody(body, 'productId', { required: true }) ?? '',
      workspaceId: stringBody(body, 'workspaceId'),
    });
    return apiOk({ alias });
  } catch (error) {
    return apiError(400, 'DOMAIN_ALIAS_UPDATE_FAILED', 'Unable to update domain alias.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

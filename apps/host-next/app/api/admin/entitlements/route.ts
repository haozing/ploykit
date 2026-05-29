import { apiOk, readJsonObject, requireApiSession, stringBody } from '@host/lib/api';
import { listAdminEntitlements, readAdminApiQuery } from '@host/lib/admin-api';
import {
  grantAdminEntitlement,
  overrideAdminEntitlement,
  revokeAdminEntitlement,
} from '@host/lib/admin-operations';
import type { RuntimeStoreEntitlementStatus } from '@/lib/module-runtime';

function statusBody(value: string | undefined): RuntimeStoreEntitlementStatus {
  if (value === 'active' || value === 'revoked' || value === 'expired') {
    return value;
  }
  throw new Error('ADMIN_ENTITLEMENT_STATUS_INVALID');
}

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.entitlements.read', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk(await listAdminEntitlements(readAdminApiQuery(request)));
}

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'admin.entitlements.write', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  const grant = await grantAdminEntitlement(resolved.session, {
    userId: stringBody(body, 'userId', { required: true, maxLength: 120 })!,
    entitlement: stringBody(body, 'entitlement', { required: true, maxLength: 160 })!,
    planId: stringBody(body, 'planId', { maxLength: 120 }),
    expiresAt: stringBody(body, 'expiresAt', { maxLength: 80 }),
  });
  return apiOk({ grant });
}

export async function PATCH(request: Request) {
  const resolved = await requireApiSession(request, 'admin.entitlements.write', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  const action = stringBody(body, 'action', { required: true, maxLength: 40 });
  if (action === 'override') {
    const grant = await overrideAdminEntitlement(resolved.session, {
      entitlementId: stringBody(body, 'entitlementId', { required: true, maxLength: 160 })!,
      status: statusBody(stringBody(body, 'status', { required: true, maxLength: 40 })),
      expiresAt: stringBody(body, 'expiresAt', { maxLength: 80 }),
      reason: stringBody(body, 'reason', { maxLength: 240 }),
    });
    return apiOk({ grant });
  }
  if (action !== 'revoke') {
    return Response.json(
      { ok: false, code: 'ADMIN_ENTITLEMENT_ACTION_UNSUPPORTED' },
      { status: 400 }
    );
  }
  const grant = await revokeAdminEntitlement(
    resolved.session,
    stringBody(body, 'entitlementId', { required: true, maxLength: 160 })!
  );
  return apiOk({ grant });
}

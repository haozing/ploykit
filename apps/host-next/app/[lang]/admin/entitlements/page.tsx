import { AdminEntitlementsOperationsPage } from '@host/components/admin/AdminPages';
import { listAdminEntitlements } from '@host/lib/admin-api';
import {
  getAdminCommercialView,
  grantAdminEntitlement,
  overrideAdminEntitlement,
  revokeAdminEntitlement,
} from '@host/lib/admin-operations';
import { createAdminAction } from '@host/lib/admin-action';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';
import type { RuntimeStoreEntitlementStatus } from '@/lib/module-runtime';

function readFormString(formData: FormData, name: string, required = true): string | undefined {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.trim().length === 0) {
    if (required) {
      throw new Error(`ADMIN_FORM_FIELD_REQUIRED: ${name}`);
    }
    return undefined;
  }
  return value.trim();
}

function readEntitlementStatus(formData: FormData): RuntimeStoreEntitlementStatus {
  const status = readFormString(formData, 'status')!;
  if (status === 'active' || status === 'revoked' || status === 'expired') {
    return status;
  }
  throw new Error(`ADMIN_FORM_FIELD_INVALID: status`);
}

const grantEntitlementAction = createAdminAction({
  id: 'entitlements.grant',
  parse: (formData) => ({
    userId: readFormString(formData, 'userId')!,
    entitlement: readFormString(formData, 'entitlement')!,
    planId: readFormString(formData, 'planId', false),
  }),
  run: async ({ session, input }) => grantAdminEntitlement(session, input),
  revalidate: () => ['/admin/entitlements', '/admin/revenue', '/dashboard/billing'],
  audit: {
    metadata: ({ input }) => ({
      userId: input.userId,
      entitlement: input.entitlement,
      planId: input.planId,
    }),
  },
});

const overrideEntitlementAction = createAdminAction({
  id: 'entitlements.override',
  parse: (formData) => {
    const expiresAt = readFormString(formData, 'expiresAt', false);
    return {
      entitlementId: readFormString(formData, 'entitlementId')!,
      status: readEntitlementStatus(formData),
      expiresAt: expiresAt === 'clear' ? null : expiresAt,
      reason: readFormString(formData, 'reason', false),
    };
  },
  run: async ({ session, input }) => overrideAdminEntitlement(session, input),
  revalidate: () => ['/admin/entitlements', '/admin/revenue', '/dashboard/billing'],
  audit: {
    metadata: ({ input }) => ({
      entitlementId: input.entitlementId,
      status: input.status,
      reason: input.reason,
    }),
  },
});

const revokeEntitlementAction = createAdminAction({
  id: 'entitlements.revoke',
  parse: (formData) => ({ entitlementId: readFormString(formData, 'entitlementId')! }),
  run: async ({ session, input }) => revokeAdminEntitlement(session, input.entitlementId),
  revalidate: () => ['/admin/entitlements', '/dashboard/billing'],
  audit: { metadata: ({ input }) => ({ entitlementId: input.entitlementId }) },
});

export default async function AdminEntitlementsPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang] = await readLanguageAndRequireAdmin(params, '/admin/entitlements');
  const query = await readAdminTableQuery(searchParams);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const commercial = await getAdminCommercialView();
  return (
    <AdminEntitlementsOperationsPage
      lang={lang}
      commercial={commercial}
      entitlements={await listAdminEntitlements({
        q: query.q,
        status: query.status,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })}
      grantEntitlementAction={grantEntitlementAction}
      overrideEntitlementAction={overrideEntitlementAction}
      revokeEntitlementAction={revokeEntitlementAction}
      query={query}
    />
  );
}

import { NextResponse } from 'next/server';

import { taxProfileSchema, upsertTaxProfile } from '@/lib/services/billing/local-billing-service';
import {
  withAdminGuard,
  withBodyValidation,
  withErrorHandling,
  type AuthContext,
} from '@/lib/middleware';
import { AUDIT_ACTIONS, auditLogDurable } from '@/lib/services/audit/audit-service';
import { getClientIP } from '@/lib/shared/api-helpers';

export const POST = withAdminGuard(
  withErrorHandling(
    withBodyValidation(taxProfileSchema, async (request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };
      const taxProfile = await upsertTaxProfile(validated.body!);

      await auditLogDurable({
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.BILLING_TAX_PROFILE_UPSERT,
        resource: 'billing_tax_profile',
        resourceId: taxProfile.id,
        status: 'success',
        ipAddress: getClientIP(request),
        metadata: {
          targetUserId: taxProfile.userId,
          country: taxProfile.country,
          status: taxProfile.status,
        },
      });

      return NextResponse.json({
        success: true,
        taxProfile,
      });
    })
  )
);

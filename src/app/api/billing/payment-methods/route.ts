import { NextResponse } from 'next/server';

import {
  localPaymentMethodSchema,
  upsertPaymentMethod,
} from '@/lib/services/billing/local-billing-service';
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
    withBodyValidation(localPaymentMethodSchema, async (request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };
      const paymentMethod = await upsertPaymentMethod(validated.body!);

      await auditLogDurable({
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.BILLING_PAYMENT_METHOD_CREATE,
        resource: 'billing_payment_method',
        resourceId: paymentMethod.id,
        status: 'success',
        ipAddress: getClientIP(request),
        metadata: {
          targetUserId: paymentMethod.userId,
          provider: paymentMethod.provider,
          type: paymentMethod.type,
          isDefault: paymentMethod.isDefault,
        },
      });

      return NextResponse.json(
        {
          success: true,
          paymentMethod,
        },
        { status: 201 }
      );
    })
  )
);

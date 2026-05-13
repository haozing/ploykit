import { NextResponse } from 'next/server';

import { listUserPaymentMethods } from '@/lib/services/billing/local-billing-service';
import {
  withAuth,
  withAuthenticatedUserContext,
  withErrorHandling,
  type AuthContext,
} from '@/lib/middleware';

export const GET = withAuth(
  withErrorHandling(
    withAuthenticatedUserContext(async (_request, context: { auth: AuthContext }) => {
      const paymentMethods = await listUserPaymentMethods(context.auth.userId);

      return NextResponse.json({
        success: true,
        paymentMethods,
      });
    })
  )
);

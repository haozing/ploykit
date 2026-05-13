import { NextResponse } from 'next/server';

import { getUserTaxProfile } from '@/lib/services/billing/local-billing-service';
import {
  withAuth,
  withAuthenticatedUserContext,
  withErrorHandling,
  type AuthContext,
} from '@/lib/middleware';

export const GET = withAuth(
  withErrorHandling(
    withAuthenticatedUserContext(async (_request, context: { auth: AuthContext }) => {
      const taxProfile = await getUserTaxProfile(context.auth.userId);

      return NextResponse.json({
        success: true,
        taxProfile,
      });
    })
  )
);

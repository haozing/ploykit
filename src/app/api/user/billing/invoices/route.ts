import { NextResponse } from 'next/server';

import { listUserInvoices } from '@/lib/services/billing/local-billing-service';
import {
  withAuth,
  withAuthenticatedUserContext,
  withErrorHandling,
  type AuthContext,
} from '@/lib/middleware';

export const GET = withAuth(
  withErrorHandling(
    withAuthenticatedUserContext(async (request, context: { auth: AuthContext }) => {
      const searchParams = request.nextUrl.searchParams;
      const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 100);
      const offset = Math.max(Number(searchParams.get('offset') || 0), 0);
      const invoices = await listUserInvoices(context.auth.userId, limit, offset);

      return NextResponse.json({
        success: true,
        invoices,
        pagination: {
          limit,
          offset,
          hasMore: invoices.length === limit,
        },
      });
    })
  )
);

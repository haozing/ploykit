import { NextResponse, type NextRequest } from 'next/server';

import {
  createLocalInvoice,
  listAllInvoices,
  localInvoiceSchema,
} from '@/lib/services/billing/local-billing-service';
import {
  withAdminGuard,
  withBodyValidation,
  withErrorHandling,
  type AuthContext,
} from '@/lib/middleware';
import { AUDIT_ACTIONS, auditLogDurable } from '@/lib/services/audit/audit-service';
import { getClientIP } from '@/lib/shared/api-helpers';

export const GET = withAdminGuard(
  withErrorHandling(async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 100);
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0);
    const invoices = await listAllInvoices(limit, offset);

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
);

export const POST = withAdminGuard(
  withErrorHandling(
    withBodyValidation(localInvoiceSchema, async (request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };
      const invoice = await createLocalInvoice(validated.body!);

      await auditLogDurable({
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.BILLING_INVOICE_CREATE,
        resource: 'billing_invoice',
        resourceId: invoice.id,
        resourceName: invoice.invoiceNumber,
        status: 'success',
        ipAddress: getClientIP(request),
        metadata: {
          targetUserId: invoice.userId,
          totalAmount: invoice.totalAmount,
          currency: invoice.currency,
        },
      });

      return NextResponse.json(
        {
          success: true,
          invoice,
        },
        { status: 201 }
      );
    })
  )
);

import { NextResponse } from 'next/server';

import { runCreditReconciliation } from '@/lib/services/billing/credit-log-service';
import { withAdminGuard, withErrorHandling, type AuthContext } from '@/lib/middleware';
import { AUDIT_ACTIONS, auditLogDurable } from '@/lib/services/audit/audit-service';
import { getClientIP } from '@/lib/shared/api-helpers';

export const POST = withAdminGuard(
  withErrorHandling(async (request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };
    const result = await runCreditReconciliation();

    await auditLogDurable({
      userId: auth.userId,
      userEmail: auth.userEmail,
      action: AUDIT_ACTIONS.CREDIT_RECONCILIATION_RUN,
      resource: 'credit_reconciliation_run',
      resourceId: result.runId,
      status: result.mismatchCount === 0 ? 'success' : 'failure',
      ipAddress: getClientIP(request),
      metadata: {
        checkedUsers: result.checkedUsers,
        mismatchCount: result.mismatchCount,
      },
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  })
);

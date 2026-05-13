import { NextResponse } from 'next/server';

import { NotFoundError } from '@/lib/_core/errors';
import { replayOutboxDeadLetter } from '@/lib/bus/outbox-admin.server';
import {
  withAdminGuard,
  withErrorHandling,
  type AuthContext,
  type RouteContext,
} from '@/lib/middleware';
import { getClientIP, getUserAgent } from '@/lib/shared/api-helpers';
import { AUDIT_ACTIONS, auditLogSync } from '@/lib/services/audit/audit-service';

export const POST = withAdminGuard<RouteContext<{ id: string }>>(
  withErrorHandling<RouteContext<{ id: string }>>(async (request, context) => {
    const { id } = await context.params;
    const { auth } = context as typeof context & { auth: AuthContext };
    const result = await replayOutboxDeadLetter(id);

    if (!result.replayed) {
      throw new NotFoundError('Outbox dead letter', id);
    }

    await auditLogSync({
      userId: auth.userId,
      userEmail: auth.userEmail,
      action: AUDIT_ACTIONS.OUTBOX_DEAD_LETTER_REPLAY,
      resource: 'event_outbox',
      resourceId: id,
      resourceName: 'Outbox dead letter',
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request),
      status: 'success',
      metadata: {
        after: {
          stats: result.stats,
        },
      },
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  })
);

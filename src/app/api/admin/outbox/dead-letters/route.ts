import { NextResponse } from 'next/server';
import { z } from 'zod';

import { handleOutboxDeadLettersBulk, listOutboxDeadLetters } from '@/lib/bus/outbox-admin.server';
import {
  withAdminGuard,
  withBodyValidation,
  withErrorHandling,
  type AuthContext,
} from '@/lib/middleware';
import { AUDIT_ACTIONS, auditLogDurable } from '@/lib/services/audit/audit-service';
import { getClientIP } from '@/lib/shared/api-helpers';

export const GET = withAdminGuard(
  withErrorHandling(async () => {
    const deadLetters = await listOutboxDeadLetters();

    return NextResponse.json({
      success: true,
      ...deadLetters,
    });
  })
);

const bulkActionSchema = z.object({
  action: z.enum(['replay', 'ignore', 'archive']),
  entryIds: z.array(z.string().min(1)).min(1).max(100),
  reason: z.string().trim().max(500).optional(),
});

export const POST = withAdminGuard(
  withErrorHandling(
    withBodyValidation(bulkActionSchema, async (request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };
      const body = validated.body!;
      const result = await handleOutboxDeadLettersBulk(body.entryIds, body.action, body.reason);

      await auditLogDurable({
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.OUTBOX_DEAD_LETTER_BULK,
        resource: 'event_outbox',
        status: 'success',
        ipAddress: getClientIP(request),
        metadata: {
          action: result.action,
          requested: body.entryIds.length,
          handled: result.handled,
          skipped: result.skipped,
          reason: body.reason,
        },
      });

      return NextResponse.json({
        success: true,
        ...result,
      });
    })
  )
);

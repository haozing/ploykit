import { NextResponse } from 'next/server';
import { z } from 'zod';

import { handleOutboxDeadLetter } from '@/lib/bus/outbox-admin.server';
import {
  withAdminGuard,
  withErrorHandling,
  withValidation,
  type AuthContext,
} from '@/lib/middleware';
import { AUDIT_ACTIONS, auditLogDurable } from '@/lib/services/audit/audit-service';
import { getClientIP } from '@/lib/shared/api-helpers';

const paramsSchema = z.object({
  id: z.string().min(1),
});

const bodySchema = z.object({
  action: z.enum(['replay', 'ignore', 'archive']),
  reason: z.string().trim().max(500).optional(),
});

function auditAction(action: 'replay' | 'ignore' | 'archive') {
  if (action === 'replay') return AUDIT_ACTIONS.OUTBOX_DEAD_LETTER_REPLAY;
  if (action === 'ignore') return AUDIT_ACTIONS.OUTBOX_DEAD_LETTER_IGNORE;
  return AUDIT_ACTIONS.OUTBOX_DEAD_LETTER_ARCHIVE;
}

export const POST = withAdminGuard(
  withErrorHandling(
    withValidation({ params: paramsSchema, body: bodySchema }, async (request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };
      const body = validated.body!;
      const result = await handleOutboxDeadLetter(validated.params!.id, body.action, body.reason);

      await auditLogDurable({
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: auditAction(body.action),
        resource: 'event_outbox',
        resourceId: validated.params!.id,
        status: result.handled ? 'success' : 'failure',
        ipAddress: getClientIP(request),
        metadata: {
          action: body.action,
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

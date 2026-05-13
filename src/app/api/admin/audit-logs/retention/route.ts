import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  applyAuditLogRetention,
  AUDIT_ACTIONS,
  auditLogDurable,
} from '@/lib/services/audit/audit-service';
import {
  withAdminGuard,
  withBodyValidation,
  withErrorHandling,
  type AuthContext,
} from '@/lib/middleware';
import { hasPermissionIdentifier } from '@/lib/auth/permissions';
import { ForbiddenError } from '@/lib/_core/errors';
import { getClientIP } from '@/lib/shared/api-helpers';

const retentionSchema = z.object({
  retentionDays: z.number().int().min(30).max(3650),
});

export const POST = withAdminGuard(
  withErrorHandling(
    withBodyValidation(retentionSchema, async (request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };

      if (!(await hasPermissionIdentifier(auth.userId, 'audit:retention:all'))) {
        throw new ForbiddenError('Audit retention requires audit:retention:all', {
          requiredPermission: 'audit:retention:all',
        });
      }

      const result = await applyAuditLogRetention(validated.body!.retentionDays);

      await auditLogDurable({
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.AUDIT_RETENTION_RUN,
        resource: 'audit_log',
        status: 'success',
        ipAddress: getClientIP(request),
        metadata: {
          retentionDays: result.retentionDays,
          cutoff: result.cutoff.toISOString(),
          deleted: result.deleted,
        },
      });

      return NextResponse.json({
        success: true,
        ...result,
        cutoff: result.cutoff.toISOString(),
      });
    })
  )
);

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revokeRoleFromUser } from '@/lib/services/rbac/role-service';
import {
  withAdminGuard,
  withErrorHandling,
  withValidation,
  type AuthContext,
} from '@/lib/middleware';
import { commonSchemas } from '@/lib/validations/common';
import { getClientIP } from '@/lib/shared/api-helpers';

/**
 * POST /api/admin/roles/[id]/revoke
 *
 * Revoke role from user
 *
 * Body:
 * - userId: string (required)
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
const revokeRoleSchema = {
  params: z.object({
    id: commonSchemas.uuid,
  }),
  body: z.object({
    userId: z.string().min(1, 'User ID is required'),
  }),
};

export const POST = withAdminGuard(
  withErrorHandling(
    withValidation(revokeRoleSchema, async (request, context) => {
      const { validated, auth } = context as typeof context & { auth: AuthContext };
      const ipAddress = getClientIP(request);

      await revokeRoleFromUser(
        validated.body!.userId,
        validated.params!.id,
        auth.userId,
        ipAddress
      );

      return NextResponse.json(
        { success: true, message: 'Role revoked successfully' },
        { status: 200 }
      );
    })
  )
);

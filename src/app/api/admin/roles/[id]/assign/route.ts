import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assignRoleToUser } from '@/lib/services/rbac/role-service';
import {
  withAdminGuard,
  withErrorHandling,
  withValidation,
  type AuthContext,
} from '@/lib/middleware';
import { commonSchemas } from '@/lib/validations/common';
import { getClientIP } from '@/lib/shared/api-helpers';

/**
 * POST /api/admin/roles/[id]/assign
 *
 * Assign role to user
 *
 * URL Params:
 * - id: string (role ID, UUID)
 *
 * Body:
 * - userId: string (required, Better Auth text id)
 * - expiresAt?: string (optional, ISO date)
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
const assignRoleSchema = {
  params: z.object({
    id: commonSchemas.uuid,
  }),
  body: z.object({
    userId: z.string().min(1, 'User ID is required'),
    expiresAt: z.string().datetime().optional(),
  }),
};

export const POST = withAdminGuard(
  withErrorHandling(
    withValidation(assignRoleSchema, async (request, context) => {
      const { validated, auth } = context as typeof context & { auth: AuthContext };
      const ipAddress = getClientIP(request);

      const assignment = await assignRoleToUser(
        validated.body!.userId,
        validated.params!.id,
        auth.userId,
        ipAddress,
        validated.body!.expiresAt ? new Date(validated.body!.expiresAt) : undefined
      );

      return NextResponse.json(assignment, { status: 201 });
    })
  )
);

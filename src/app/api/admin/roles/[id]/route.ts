import { NextResponse } from 'next/server';
import { getRoleById, updateRole, deleteRole } from '@/lib/services/rbac/role-service';
import {
  withAdminGuard,
  withErrorHandling,
  withParamsValidation,
  withValidation,
  type AuthContext,
} from '@/lib/middleware';
import { commonSchemas } from '@/lib/validations/common';
import { getClientIP } from '@/lib/shared/api-helpers';
import { updateRoleSchema } from '@/lib/validations/role';
import { z } from 'zod';

/**
 * GET /api/admin/roles/[id]
 *
 * Get role details by ID
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */

const paramsSchema = z.object({
  id: commonSchemas.uuid,
});

export const GET = withAdminGuard(
  withErrorHandling(
    withParamsValidation(paramsSchema, async (request, { validated }) => {
      const role = await getRoleById(validated.params!.id);
      return NextResponse.json({
        success: true,
        data: role,
      });
    })
  )
);

/**
 * PUT /api/admin/roles/[id]
 *
 * Update role information
 *
 * Body:
 * - name?: string
 * - slug?: string
 * - description?: string
 * - permissions?: string[]
 * - isDefault?: boolean
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */

const updateRoleValidation = {
  params: paramsSchema,
  body: updateRoleSchema,
};

export const PUT = withAdminGuard(
  withErrorHandling(
    withValidation(updateRoleValidation, async (request, context) => {
      const { validated, auth } = context as typeof context & { auth: AuthContext };
      const ipAddress = getClientIP(request);

      const updatedRole = await updateRole(
        validated.params!.id,
        validated.body!,
        auth.userId,
        ipAddress
      );

      return NextResponse.json({
        success: true,
        data: updatedRole,
      });
    })
  )
);

/**
 * DELETE /api/admin/roles/[id]
 *
 * Delete role
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const DELETE = withAdminGuard(
  withErrorHandling(
    withParamsValidation(paramsSchema, async (request, context) => {
      const { validated, auth } = context as typeof context & { auth: AuthContext };
      const ipAddress = getClientIP(request);

      await deleteRole(validated.params!.id, auth.userId, ipAddress);

      return NextResponse.json({ success: true, message: 'Role deleted successfully' });
    })
  )
);

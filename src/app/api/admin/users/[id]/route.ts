import { NextResponse } from 'next/server';
import { getUserById, updateUser, deleteUser } from '@/lib/services/user/user-service';
import {
  withErrorHandling,
  withParamsValidation,
  withValidation,
  withAdminGuard,
  type AuthContext,
} from '@/lib/middleware';
import { getClientIP } from '@/lib/shared/api-helpers';
import { updateUserSchema } from '@/lib/validations/user';
import { z } from 'zod';
import { ForbiddenError } from '@/lib/_core/errors';

/**
 * GET /api/admin/users/[id]
 *
 * Get user details by ID
 *
 * ACCESS CONTROL:
 * - Requires admin role
 * - Admin can view any user
 */

const paramsSchema = z.object({
  // Changed from UUID to string to support Better Auth's custom ID format (e.g., "admin_1761723042830")
  id: z.string().min(1, 'User ID is required'),
});

export const GET = withAdminGuard(
  withErrorHandling(
    withParamsValidation(paramsSchema, async (request, context) => {
      const { validated } = context;

      const targetUserId = validated.params!.id;

      const user = await getUserById(targetUserId);
      return NextResponse.json({
        success: true,
        user,
      });
    })
  )
);

/**
 * PUT /api/admin/users/[id]
 *
 * Update user information
 *
 * Body:
 * - name?: string
 * - email?: string
 * - image?: string
 *
 * ACCESS CONTROL:
 * - Requires admin role
 * - Admin can update any user
 */

const updateUserValidation = {
  params: paramsSchema,
  body: updateUserSchema,
};

export const PUT = withAdminGuard(
  withErrorHandling(
    withValidation(updateUserValidation, async (request, context) => {
      const { validated, auth } = context as typeof context & { auth: AuthContext };

      const targetUserId = validated.params!.id;

      const ipAddress = getClientIP(request);

      const updatedUser = await updateUser(targetUserId, validated.body!, auth.userId, ipAddress);

      return NextResponse.json({
        success: true,
        user: updatedUser,
      });
    })
  )
);

/**
 * DELETE /api/admin/users/[id]
 *
 * Delete user (soft delete)
 *
 * ACCESS CONTROL:
 * - Requires admin role
 * - Admin can delete any user
 */
export const DELETE = withAdminGuard(
  withErrorHandling(
    withParamsValidation(paramsSchema, async (request, context) => {
      const { validated, auth } = context as typeof context & { auth: AuthContext };

      const targetUserId = validated.params!.id;

      if (targetUserId === auth.userId) {
        throw new ForbiddenError('Administrators cannot delete their own profile.');
      }

      const ipAddress = getClientIP(request);

      await deleteUser(targetUserId, auth.userId, ipAddress);

      return NextResponse.json({ success: true, message: 'User deleted successfully' });
    })
  )
);

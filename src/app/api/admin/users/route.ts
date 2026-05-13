import { NextResponse } from 'next/server';
import { listUsers } from '@/lib/services/user/user-service';
import { withAdminGuard, withErrorHandling, withQueryValidation } from '@/lib/middleware';
import { createPaginatedListSchema } from '@/lib/validations/common';
import { z } from 'zod';

/**
 * GET /api/admin/users
 *
 * List users with optional filtering and pagination
 *
 * Query params:
 * - search: string (search in name/email)
 * - status: active | pending | suspended | deleted
 * - page: number (default: 1)
 * - limit: number (default: 20)
 *
 * ACCESS CONTROL:
 * - Requires admin role
 * - Returns all users (user-level architecture)
 */

const listUsersSchema = createPaginatedListSchema({
  status: z.enum(['active', 'pending', 'suspended', 'deleted']).optional(),
});

export const GET = withAdminGuard(
  withErrorHandling(
    withQueryValidation(listUsersSchema, async (request, { validated }) => {
      const result = await listUsers(validated.query);

      return NextResponse.json({
        success: true,
        users: result.items,
        pagination: result.pagination,
      });
    })
  )
);

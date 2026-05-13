import { NextResponse } from 'next/server';
import { listRoles, createRole } from '@/lib/services/rbac/role-service';
import {
  withAdminGuard,
  withErrorHandling,
  withQueryValidation,
  withBodyValidation,
  type AuthContext,
} from '@/lib/middleware';
import { getClientIP } from '@/lib/shared/api-helpers';
import { createRoleSchema } from '@/lib/validations/role';
import { createPaginatedListSchema } from '@/lib/validations/common';

/**
 * GET /api/admin/roles
 *
 * List roles with optional filtering and pagination
 *
 * Query params:
 * - search: string (search in name/slug)
 * - page: number (default: 1)
 * - limit: number (default: 20)
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */

const listRolesSchema = createPaginatedListSchema();

export const GET = withAdminGuard(
  withErrorHandling(
    withQueryValidation(listRolesSchema, async (request, { validated }) => {
      const result = await listRoles(validated.query);
      return NextResponse.json({
        success: true,
        roles: result.roles,
        pagination: result.pagination,
      });
    })
  )
);

/**
 * POST /api/admin/roles
 *
 * Create a new role
 *
 * Body:
 * - name: string (required)
 * - slug: string (required)
 * - description?: string
 * - permissions: string[] (required)
 * - isDefault?: boolean
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const POST = withAdminGuard(
  withErrorHandling(
    withBodyValidation(createRoleSchema, async (request, context) => {
      const { validated, auth } = context as typeof context & { auth: AuthContext };
      const ipAddress = getClientIP(request);

      const newRole = await createRole(
        {
          ...validated.body!,
          permissions: validated.body!.permissions || [],
          isDefault: validated.body!.isDefault ?? false,
        },
        auth.userId,
        ipAddress
      );

      return NextResponse.json(
        {
          success: true,
          role: newRole,
        },
        { status: 201 }
      );
    })
  )
);

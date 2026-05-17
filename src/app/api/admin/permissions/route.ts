import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listPermissions, getPermissionTemplates } from '@/lib/services/rbac/permission-service';
import { withAdminGuard, withErrorHandling, withQueryValidation } from '@/lib/middleware';

/**
 * GET /api/admin/permissions
 *
 * List available permissions
 *
 * Query params:
 * - search: string (search in identifier/description)
 * - resource: string (filter by resource)
 * - templates: boolean (return predefined templates)
 *
 * @requires Authentication
 */
const listPermissionsSchema = z.object({
  search: z.string().optional(),
  resource: z.string().optional(),
  templates: z.coerce.boolean().default(false),
});

export const GET = withAdminGuard(
  withErrorHandling(
    withQueryValidation(listPermissionsSchema, async (request, { validated }) => {
      const query = validated.query!;
      const { search, resource, templates } = query;

      // If templates=true, return predefined templates
      if (templates) {
        const templateList = getPermissionTemplates();
        return NextResponse.json(
          {
            success: true,
            permissions: templateList,
          },
          { status: 200 }
        );
      }

      const filters = {
        search,
        resource,
      };

      const permissions = await listPermissions(filters);

      return NextResponse.json(
        {
          success: true,
          permissions,
        },
        { status: 200 }
      );
    })
  )
);

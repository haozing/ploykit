import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryAuditLogs } from '@/lib/services/audit/audit-service';
import { withAdminGuard, withErrorHandling, withQueryValidation } from '@/lib/middleware';
import { commonSchemas } from '@/lib/validations/common';

/**
 * GET /api/admin/audit-logs
 *
 * Query audit logs with filtering and pagination
 *
 * Query params:
 * - userId: string (filter by user)
 * - action: string (filter by action type)
 * - resource: string (filter by resource type)
 * - status: success | failure (filter by status)
 * - search: string (search in names, emails, actions)
 * - startDate: ISO date string
 * - endDate: ISO date string
 * - page: number (default: 1)
 * - limit: number (default: 50)
 *
 * @requires Authentication
 */
const queryAuditLogsSchema = z.object({
  ...commonSchemas.pagination.shape,
  ...commonSchemas.search.shape,
  userId: z.string().min(1).max(255).optional(),
  action: z.string().optional(),
  resource: z.string().optional(),
  status: z.enum(['success', 'failure']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const GET = withAdminGuard(
  withErrorHandling(
    withQueryValidation(queryAuditLogsSchema, async (request, { validated }) => {
      // Convert date strings to Date objects
      const query = validated.query || {};
      const filters = {
        ...query,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
      };

      const result = await queryAuditLogs(filters);

      return NextResponse.json(
        {
          success: true,
          logs: result.logs,
          pagination: result.pagination,
        },
        { status: 200 }
      );
    })
  )
);

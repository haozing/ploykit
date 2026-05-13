/**
 * User Orders API
 *
 * GET /api/user/orders - Get current user's order history
 */

import { getUserOrders } from '@/lib/services/billing/order-service';
import { NextResponse } from 'next/server';
import { DatabaseError, ValidationError } from '@/lib/_core/errors';
import { buildExportWatermark, toWatermarkedCsv } from '@/lib/services/billing/export-utils';
import { AUDIT_ACTIONS, auditLogDurable } from '@/lib/services/audit/audit-service';
import { getClientIP, getUserAgent } from '@/lib/shared/api-helpers';
import {
  withAuth,
  withAuthenticatedUserContext,
  withErrorHandling,
  type AuthContext,
} from '@/lib/middleware';

export const GET = withAuth(
  withErrorHandling(
    withAuthenticatedUserContext(async (request, context: { auth: AuthContext }) => {
      const { auth } = context;

      // Parse query parameters
      const { searchParams } = new URL(request.url);
      const limit = Number(searchParams.get('limit') || '50');
      const offset = Number(searchParams.get('offset') || '0');
      const format = searchParams.get('format') || 'json';

      // Validate limit
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new ValidationError('Limit must be between 1 and 100', {
          field: 'limit',
          minimum: 1,
          maximum: 100,
        });
      }

      if (!Number.isInteger(offset) || offset < 0) {
        throw new ValidationError('Offset must be greater than or equal to 0', {
          field: 'offset',
          minimum: 0,
        });
      }

      if (!['json', 'csv'].includes(format)) {
        throw new ValidationError('Format must be json or csv', {
          field: 'format',
          allowed: ['json', 'csv'],
        });
      }

      try {
        // Get user's orders
        const orders = await getUserOrders(auth.userId, limit, offset);

        if (format === 'csv') {
          const exportedAt = new Date();
          const fields = [
            'id',
            'createdAt',
            'orderType',
            'status',
            'amount',
            'currency',
            'provider',
            'plan',
          ];
          const watermark = buildExportWatermark({
            actorId: auth.userId,
            actorEmail: auth.userEmail,
            resource: 'orders',
            exportedAt,
          });
          const csv = toWatermarkedCsv(watermark, [
            ['id', 'createdAt', 'orderType', 'status', 'amount', 'currency', 'provider', 'plan'],
            ...orders.map((order) => [
              order.id,
              order.createdAt,
              order.orderType,
              order.status,
              order.amount,
              order.currency,
              order.provider,
              order.plan?.name ?? '',
            ]),
          ]);

          await auditLogDurable({
            userId: auth.userId,
            userEmail: auth.userEmail,
            action: AUDIT_ACTIONS.DATA_EXPORT,
            resource: 'orders',
            status: 'success',
            ipAddress: getClientIP(request),
            userAgent: getUserAgent(request),
            metadata: {
              format,
              limit,
              offset,
              rowCount: orders.length,
              fields,
              watermark,
              exportedAt: exportedAt.toISOString(),
            },
          });

          return new NextResponse(csv, {
            headers: {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': 'attachment; filename="orders.csv"',
            },
          });
        }

        return NextResponse.json({
          orders,
          count: orders.length,
          pagination: {
            limit,
            offset,
            hasMore: orders.length === limit,
          },
        });
      } catch (error) {
        throw new DatabaseError('Failed to fetch orders', {
          operation: 'getUserOrders',
          userId: auth.userId,
          cause: error instanceof Error ? error.name : typeof error,
        });
      }
    })
  )
);

/**
 * User Credit History API
 *
 * GET /api/user/credit-history - Get current user's credit change history
 */

import { getUserCreditLogs } from '@/lib/services/billing/credit-log-service';
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
        // Get user's credit logs
        const logs = await getUserCreditLogs(auth.userId, limit, offset);

        if (format === 'csv') {
          const exportedAt = new Date();
          const fields = [
            'id',
            'createdAt',
            'logType',
            'changeAmount',
            'balanceAfter',
            'reason',
            'relatedOrderId',
          ];
          const watermark = buildExportWatermark({
            actorId: auth.userId,
            actorEmail: auth.userEmail,
            resource: 'credit-history',
            exportedAt,
          });
          const csv = toWatermarkedCsv(watermark, [
            [
              'id',
              'createdAt',
              'logType',
              'changeAmount',
              'balanceAfter',
              'reason',
              'relatedOrderId',
            ],
            ...logs.map((log) => [
              log.id,
              log.createdAt,
              log.logType,
              log.changeAmount,
              log.balanceAfter,
              log.reason,
              log.relatedOrderId,
            ]),
          ]);

          await auditLogDurable({
            userId: auth.userId,
            userEmail: auth.userEmail,
            action: AUDIT_ACTIONS.DATA_EXPORT,
            resource: 'credit_history',
            status: 'success',
            ipAddress: getClientIP(request),
            userAgent: getUserAgent(request),
            metadata: {
              format,
              limit,
              offset,
              rowCount: logs.length,
              fields,
              watermark,
              exportedAt: exportedAt.toISOString(),
            },
          });

          return new NextResponse(csv, {
            headers: {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': 'attachment; filename="credit-history.csv"',
            },
          });
        }

        return NextResponse.json({
          logs,
          count: logs.length,
          pagination: {
            limit,
            offset,
            hasMore: logs.length === limit,
          },
        });
      } catch (error) {
        throw new DatabaseError('Failed to fetch credit history', {
          operation: 'getUserCreditLogs',
          userId: auth.userId,
          cause: error instanceof Error ? error.name : typeof error,
        });
      }
    })
  )
);

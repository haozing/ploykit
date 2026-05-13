import { NextResponse, type NextRequest } from 'next/server';

import {
  edgeAccessLogBatchSchema,
  getEdgeAccessLogStats,
  ingestEdgeAccessLogs,
  listEdgeAccessLogs,
} from '@/lib/services/reliability/edge-access-log-service';
import {
  withAdminGuard,
  withBodyValidation,
  withErrorHandling,
  type AuthContext,
} from '@/lib/middleware';
import { AUDIT_ACTIONS, auditLogDurable } from '@/lib/services/audit/audit-service';
import { getClientIP } from '@/lib/shared/api-helpers';

export const GET = withAdminGuard(
  withErrorHandling(async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;
    const days = Math.min(Math.max(Number(searchParams.get('days') || 30), 1), 365);
    const failureType = searchParams.get('failureType') || undefined;
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 500);
    const [logs, stats] = await Promise.all([
      listEdgeAccessLogs({ days, failureType, limit }),
      getEdgeAccessLogStats({ days, failureType }),
    ]);

    return NextResponse.json({
      success: true,
      logs,
      stats,
    });
  })
);

export const POST = withAdminGuard(
  withErrorHandling(
    withBodyValidation(edgeAccessLogBatchSchema, async (request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };
      const result = await ingestEdgeAccessLogs(validated.body!);

      await auditLogDurable({
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.EDGE_ACCESS_LOG_INGEST,
        resource: 'edge_access_log',
        status: 'success',
        ipAddress: getClientIP(request),
        metadata: result,
      });

      return NextResponse.json(
        {
          success: true,
          ...result,
        },
        { status: 201 }
      );
    })
  )
);

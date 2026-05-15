import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/middleware';
import {
  applyInternalServiceCallLogRetention,
  internalServiceLogsRetentionSchema,
  internalServiceLogsQuerySchema,
  listInternalServiceCallLogs,
} from '@/lib/plugin-runtime/admin';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async (request: NextRequest) => {
  const query = internalServiceLogsQuerySchema.parse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  const logs = await listInternalServiceCallLogs(query);
  return NextResponse.json({ success: true, logs });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = internalServiceLogsRetentionSchema.parse(await request.json());
  const result = await applyInternalServiceCallLogRetention(body);
  return NextResponse.json({ success: true, ...result });
});

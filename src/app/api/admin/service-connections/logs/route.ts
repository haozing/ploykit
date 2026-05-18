import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/middleware';
import {
  applyServiceConnectionCallLogRetention,
  serviceConnectionLogsRetentionSchema,
  serviceConnectionLogsQuerySchema,
  listServiceConnectionCallLogs,
} from '@/lib/plugin-runtime/admin';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async (request: NextRequest) => {
  const query = serviceConnectionLogsQuerySchema.parse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  const logs = await listServiceConnectionCallLogs(query);
  return NextResponse.json({ success: true, logs });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = serviceConnectionLogsRetentionSchema.parse(await request.json());
  const result = await applyServiceConnectionCallLogRetention(body);
  return NextResponse.json({ success: true, ...result });
});

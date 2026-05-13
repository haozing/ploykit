import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/middleware';
import {
  adminPluginTaskListQuerySchema,
  buildAdminPluginOperationsReport,
} from '@/lib/plugin-runtime/tasks/task-center.server';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async (request: NextRequest) => {
  const query = adminPluginTaskListQuerySchema.parse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  const report = await buildAdminPluginOperationsReport(query);
  return NextResponse.json({ success: true, ...report });
});

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/middleware';
import {
  adminConnectorActionSchema,
  adminConnectorListQuerySchema,
  handleAdminConnectorAction,
  listAdminConnectors,
} from '@/lib/plugin-runtime/tasks/task-center.server';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async (request: NextRequest) => {
  const query = adminConnectorListQuerySchema.parse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  const connectors = await listAdminConnectors(query);
  return NextResponse.json({ success: true, connectors });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = adminConnectorActionSchema.parse(await request.json());
  const result = await handleAdminConnectorAction(body);
  return NextResponse.json(result);
});

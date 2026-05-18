import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/middleware';
import type { AuthContext, DefaultRouteContext } from '@/lib/middleware';
import {
  handleServiceConnectionAction,
  serviceConnectionActionSchema,
  serviceConnectionListQuerySchema,
  listServiceConnections,
} from '@/lib/plugin-runtime/admin';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async (request: NextRequest) => {
  const query = serviceConnectionListQuerySchema.parse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  const connections = await listServiceConnections(query);
  return NextResponse.json({ success: true, connections });
});

export const POST = withAdminGuard(async (request: NextRequest, context: DefaultRouteContext) => {
  const { auth } = context as typeof context & { auth: AuthContext };
  const body = serviceConnectionActionSchema.parse(await request.json());
  const result = await handleServiceConnectionAction(body, auth.userId);
  return NextResponse.json(result);
});

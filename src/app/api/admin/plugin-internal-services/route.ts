import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/middleware';
import type { AuthContext, DefaultRouteContext } from '@/lib/middleware';
import {
  handleInternalServiceBindingAction,
  internalServiceBindingActionSchema,
  internalServiceBindingListQuerySchema,
  listInternalServiceBindings,
} from '@/lib/plugin-runtime/admin';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async (request: NextRequest) => {
  const query = internalServiceBindingListQuerySchema.parse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  const bindings = await listInternalServiceBindings(query);
  return NextResponse.json({ success: true, bindings });
});

export const POST = withAdminGuard(async (request: NextRequest, context: DefaultRouteContext) => {
  const { auth } = context as typeof context & { auth: AuthContext };
  const body = internalServiceBindingActionSchema.parse(await request.json());
  const result = await handleInternalServiceBindingAction(body, auth.userId);
  return NextResponse.json(result);
});

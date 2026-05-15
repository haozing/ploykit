import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/middleware';
import {
  handleAdminResourceBindingAction,
  listAdminResourceBindings,
  resourceBindingAdminActionSchema,
  resourceBindingAdminListQuerySchema,
} from '@/lib/plugin-runtime/admin';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async (request: NextRequest) => {
  const query = resourceBindingAdminListQuerySchema.parse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  const bindings = await listAdminResourceBindings(query);
  return NextResponse.json({ success: true, bindings });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = resourceBindingAdminActionSchema.parse(await request.json());
  const result = await handleAdminResourceBindingAction(body);
  return NextResponse.json(result);
});

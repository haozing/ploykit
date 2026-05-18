import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/middleware';
import {
  serviceConnectionRequirementsQuerySchema,
  listServiceConnectionRequirements,
} from '@/lib/plugin-runtime/admin';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async (request: NextRequest) => {
  const query = serviceConnectionRequirementsQuerySchema.parse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  const requirements = await listServiceConnectionRequirements(query);
  return NextResponse.json({ success: true, requirements });
});

import { NextRequest, NextResponse } from 'next/server';
import { listPlanCapabilityDefinitions } from '@/lib/entitlements/plan-capability-registry.server';
import { withAdminGuard } from '@/lib/middleware';
import { getRuntimeProductId } from '@/lib/plugin-runtime/product-id';

export const GET = withAdminGuard(async (request: NextRequest) => {
  const url = new URL(request.url);
  const productId = getRuntimeProductId({ productId: url.searchParams.get('productId') });
  const definitions = listPlanCapabilityDefinitions({ productId }).map(
    ({ source: _source, ...definition }) => definition
  );

  return NextResponse.json(
    {
      success: true,
      data: definitions,
    },
    { status: 200 }
  );
});

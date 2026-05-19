import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { productScopeService } from '@/lib/product-scope';
import { getRuntimeProductId } from '@/lib/plugin-runtime/product-id';
import { withAuth, withErrorHandling } from '@/lib/middleware';

const querySchema = z.object({
  productId: z.string().optional(),
  workspaceId: z.string().optional(),
});

function getQuery(request: NextRequest) {
  return querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
}

export const GET = withErrorHandling(
  withAuth(async (request, context) => {
    const query = getQuery(request);
    const state = await productScopeService.getState({
      productId: getRuntimeProductId({ productId: query.productId }),
      userId: context.auth.userId,
      userEmail: context.auth.userEmail,
      requestedWorkspaceId: query.workspaceId,
    });

    return NextResponse.json({ success: true, data: state });
  })
);

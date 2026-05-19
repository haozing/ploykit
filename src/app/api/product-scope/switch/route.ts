import { NextResponse } from 'next/server';
import { z } from 'zod';
import { productScopeService } from '@/lib/product-scope';
import { getRuntimeProductId } from '@/lib/plugin-runtime/product-id';
import { withAuth, withErrorHandling } from '@/lib/middleware';

const switchBodySchema = z.object({
  productId: z.string().optional(),
  workspaceId: z.string().min(1),
});

export const POST = withErrorHandling(
  withAuth(async (request, context) => {
    const body = switchBodySchema.parse(await request.json());
    const scope = await productScopeService.switch({
      productId: getRuntimeProductId({ productId: body.productId }),
      userId: context.auth.userId,
      userEmail: context.auth.userEmail,
      workspaceId: body.workspaceId,
    });

    return NextResponse.json({ success: true, data: scope });
  })
);

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { productScopeService } from '@/lib/product-scope';
import { getRuntimeProductId } from '@/lib/plugin-runtime/product-id';
import { withAuth, withErrorHandling } from '@/lib/middleware';

const listQuerySchema = z.object({
  productId: z.string().optional(),
});

const createBodySchema = z.object({
  productId: z.string().optional(),
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(120).optional(),
});

function getProductId(request: NextRequest, productId?: string) {
  if (productId) {
    return getRuntimeProductId({ productId });
  }
  const query = listQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return getRuntimeProductId({ productId: query.productId });
}

export const GET = withErrorHandling(
  withAuth(async (request, context) => {
    const state = await productScopeService.listState({
      productId: getProductId(request),
      userId: context.auth.userId,
      userEmail: context.auth.userEmail,
    });

    return NextResponse.json({ success: true, data: state });
  })
);

export const POST = withErrorHandling(
  withAuth(async (request, context) => {
    const body = createBodySchema.parse(await request.json());
    const scope = await productScopeService.create({
      productId: getProductId(request, body.productId),
      userId: context.auth.userId,
      userEmail: context.auth.userEmail,
      name: body.name,
      slug: body.slug,
    });

    return NextResponse.json({ success: true, data: scope }, { status: 201 });
  })
);

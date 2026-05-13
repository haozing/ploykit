import { NextRequest, NextResponse } from 'next/server';
import { assertBillingDemoApiEnabled } from '@/app/api/billing/_demo-guard';
import { mockProducts, mockSKUs } from '@/app/api/billing/_mock-data';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { NotFoundError } from '@/lib/_core/errors';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withErrorHandling(
  withAdminGuard(async (_request: NextRequest, props: RouteContext) => {
    assertBillingDemoApiEnabled();

    const { id } = await props.params;
    const sku = mockSKUs.find((item) => item.id === id);
    if (!sku) throw new NotFoundError('Billing SKU', id);

    return NextResponse.json({
      sku,
      product: mockProducts.find((product) => product.id === sku.productId),
      plan: { id: sku.planId, name: 'Demo Plan', slug: sku.planId },
    });
  })
);

export const PUT = withErrorHandling(
  withAdminGuard(async (request: NextRequest, props: RouteContext) => {
    assertBillingDemoApiEnabled();

    const { id } = await props.params;
    const sku = mockSKUs.find((item) => item.id === id);
    if (!sku) throw new NotFoundError('Billing SKU', id);

    const body = await request.json();
    sku.name = body.name ?? sku.name;
    sku.slug = body.slug ?? sku.slug;
    sku.productId = body.productId ?? sku.productId;
    sku.planId = body.planId ?? sku.planId;
    sku.price = body.price ?? sku.price;
    sku.currency = body.currency ?? sku.currency;
    sku.billingInterval = body.billingInterval ?? sku.billingInterval;
    sku.isActive = body.isActive ?? sku.isActive;
    sku.sortOrder = Number(body.sortOrder ?? sku.sortOrder) || 0;
    sku.updatedAt = new Date().toISOString();

    return NextResponse.json({ sku });
  })
);

import { NextRequest, NextResponse } from 'next/server';
import { assertBillingDemoApiEnabled } from '@/app/api/billing/_demo-guard';
import { mockProducts } from '@/app/api/billing/_mock-data';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { NotFoundError } from '@/lib/_core/errors';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withErrorHandling(
  withAdminGuard(async (_request: NextRequest, props: RouteContext) => {
    assertBillingDemoApiEnabled();

    const { id } = await props.params;
    const product = mockProducts.find((item) => item.id === id);
    if (!product) throw new NotFoundError('Billing product', id);
    return NextResponse.json({ product });
  })
);

export const PUT = withErrorHandling(
  withAdminGuard(async (request: NextRequest, props: RouteContext) => {
    assertBillingDemoApiEnabled();

    const { id } = await props.params;
    const product = mockProducts.find((item) => item.id === id);
    if (!product) throw new NotFoundError('Billing product', id);

    const body = await request.json();
    product.name = body.name ?? product.name;
    product.slug = body.slug ?? product.slug;
    product.description = body.description ?? product.description;
    product.category = body.category ?? product.category;
    product.isActive = body.isActive ?? product.isActive;
    product.sortOrder = Number(body.sortOrder ?? product.sortOrder) || 0;
    product.updatedAt = new Date().toISOString();

    return NextResponse.json({ product });
  })
);

export const DELETE = withErrorHandling(
  withAdminGuard(async (_request: NextRequest, props: RouteContext) => {
    assertBillingDemoApiEnabled();

    const { id } = await props.params;
    const index = mockProducts.findIndex((item) => item.id === id);
    if (index === -1) throw new NotFoundError('Billing product', id);

    mockProducts.splice(index, 1);
    return NextResponse.json({ success: true });
  })
);

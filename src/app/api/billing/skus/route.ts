import { NextRequest } from 'next/server';
import { assertBillingDemoApiEnabled } from '@/app/api/billing/_demo-guard';
import { generateId, jsonOk, mockProducts, mockSKUs } from '@/app/api/billing/_mock-data';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

export const GET = withErrorHandling(
  withAdminGuard(async (request: NextRequest) => {
    assertBillingDemoApiEnabled();

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const isActive = searchParams.get('isActive');
    const includeDetails = searchParams.get('includeDetails') === 'true';

    const filtered = mockSKUs.filter((sku) => {
      if (productId && sku.productId !== productId) return false;
      if (isActive !== null && isActive !== undefined) {
        const activeFlag = isActive === 'true';
        if (sku.isActive !== activeFlag) return false;
      }
      return true;
    });

    const withDetails = includeDetails
      ? filtered.map((sku) => ({
          ...sku,
          product: mockProducts.find((product) => product.id === sku.productId),
          plan: { id: sku.planId, name: 'Demo Plan', slug: sku.planId },
        }))
      : filtered;

    return jsonOk({ skus: withDetails });
  })
);

export const POST = withErrorHandling(
  withAdminGuard(async (request: NextRequest) => {
    assertBillingDemoApiEnabled();

    const body = await request.json();
    const now = new Date().toISOString();
    const newSKU = {
      id: generateId('sku'),
      productId: body.productId,
      planId: body.planId ?? 'plan_basic',
      name: body.name ?? 'Untitled SKU',
      slug: body.slug ?? generateId('slug'),
      price: body.price ?? '0',
      currency: body.currency ?? 'USD',
      billingInterval: body.billingInterval ?? 'monthly',
      isActive: body.isActive ?? true,
      sortOrder: Number(body.sortOrder) || 0,
      createdAt: now,
      updatedAt: now,
    };

    mockSKUs.push(newSKU);
    return jsonOk({ sku: newSKU }, { status: 201 });
  })
);

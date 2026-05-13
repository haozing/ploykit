import { NextRequest } from 'next/server';
import { assertBillingDemoApiEnabled } from '@/app/api/billing/_demo-guard';
import { generateId, jsonOk, mockProducts } from '@/app/api/billing/_mock-data';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

export const GET = withErrorHandling(
  withAdminGuard(async (request: NextRequest) => {
    assertBillingDemoApiEnabled();

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const isActive = searchParams.get('isActive');

    const filtered = mockProducts.filter((product) => {
      if (category && product.category !== category) return false;
      if (isActive !== null && isActive !== undefined) {
        const activeFlag = isActive === 'true';
        if (product.isActive !== activeFlag) return false;
      }
      return true;
    });

    return jsonOk({ products: filtered });
  })
);

export const POST = withErrorHandling(
  withAdminGuard(async (request: NextRequest) => {
    assertBillingDemoApiEnabled();

    const body = await request.json();
    const now = new Date().toISOString();
    const newProduct = {
      id: generateId('prod'),
      name: body.name ?? 'Untitled',
      slug: body.slug ?? generateId('slug'),
      description: body.description ?? null,
      category: body.category ?? null,
      isActive: body.isActive ?? true,
      sortOrder: Number(body.sortOrder) || 0,
      createdAt: now,
      updatedAt: now,
    };

    mockProducts.push(newProduct);
    return jsonOk({ product: newProduct }, { status: 201 });
  })
);

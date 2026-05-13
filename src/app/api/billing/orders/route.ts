import { NextRequest } from 'next/server';
import { assertBillingDemoApiEnabled } from '@/app/api/billing/_demo-guard';
import { jsonOk, mockOrders, mockSKUs } from '@/app/api/billing/_mock-data';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

export const GET = withErrorHandling(
  withAdminGuard(async (request: NextRequest) => {
    assertBillingDemoApiEnabled();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = Number(searchParams.get('limit') ?? mockOrders.length);
    const includeDetails = searchParams.get('includeDetails') === 'true';

    const filtered = mockOrders.filter((order) => {
      if (status && order.status !== status) return false;
      return true;
    });

    const sliced = filtered.slice(0, Number.isNaN(limit) ? filtered.length : limit);

    const withDetails = includeDetails
      ? sliced.map((order) => ({
          ...order,
          sku: mockSKUs.find((sku) => sku.id === order.skuId),
        }))
      : sliced;

    return jsonOk({ orders: withDetails });
  })
);

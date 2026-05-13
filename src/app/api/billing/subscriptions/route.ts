import { NextRequest } from 'next/server';
import { assertBillingDemoApiEnabled } from '@/app/api/billing/_demo-guard';
import { jsonOk, mockSKUs, mockSubscriptions } from '@/app/api/billing/_mock-data';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

export const GET = withErrorHandling(
  withAdminGuard(async (request: NextRequest) => {
    assertBillingDemoApiEnabled();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = Number(searchParams.get('limit') ?? mockSubscriptions.length);
    const includeDetails = searchParams.get('includeDetails') === 'true';

    const filtered = mockSubscriptions.filter((subscription) => {
      if (status && subscription.status !== status) return false;
      return true;
    });

    const sliced = filtered.slice(0, Number.isNaN(limit) ? filtered.length : limit);

    const withDetails = includeDetails
      ? sliced.map((subscription) => ({
          ...subscription,
          sku: mockSKUs.find((sku) => sku.id === subscription.skuId),
        }))
      : sliced;

    return jsonOk({ subscriptions: withDetails });
  })
);

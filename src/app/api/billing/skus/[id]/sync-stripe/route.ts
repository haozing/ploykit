import { NextResponse } from 'next/server';
import { assertBillingDemoApiEnabled } from '@/app/api/billing/_demo-guard';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

export const POST = withErrorHandling(
  withAdminGuard(async () => {
    assertBillingDemoApiEnabled();

    return NextResponse.json({ synced: true, provider: 'stripe', status: 'ok' });
  })
);

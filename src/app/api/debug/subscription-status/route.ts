import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { env } from '@/lib/_core/env';
import { db } from '@/lib/db';
import { userEntitlements } from '@/lib/db/schema';

export async function GET(request: NextRequest) {
  if (env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Debug endpoints are disabled in production' },
      { status: 404 }
    );
  }

  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allPlans = await db.query.entitlementPlans.findMany({
      orderBy: (plans, { asc }) => [asc(plans.sortOrder)],
    });

    const userSubscriptions = await db.query.userEntitlements.findMany({
      where: eq(userEntitlements.userId, session.user.id),
      with: {
        plan: true,
      },
      orderBy: (entitlements, { desc }) => [desc(entitlements.createdAt)],
    });

    const activeSubscription = userSubscriptions.find(
      (sub) => sub.status === 'active' || sub.status === 'trial'
    );

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      userId: session.user.id,
      userEmail: session.user.email,

      availablePlans: allPlans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        isActive: plan.isActive,
        isDefault: plan.isDefault,
        sortOrder: plan.sortOrder,
      })),

      activeSubscription: activeSubscription
        ? {
            id: activeSubscription.id,
            planId: activeSubscription.planId,
            planName: activeSubscription.plan.name,
            planSlug: activeSubscription.plan.slug,
            status: activeSubscription.status,
            startDate: activeSubscription.startDate,
            stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
            stripeCustomerId: activeSubscription.stripeCustomerId,
            createdAt: activeSubscription.createdAt,
          }
        : null,

      subscriptionHistory: userSubscriptions.map((sub) => ({
        id: sub.id,
        planId: sub.planId,
        planName: sub.plan.name,
        planSlug: sub.plan.slug,
        status: sub.status,
        startDate: sub.startDate,
        createdAt: sub.createdAt,
        updatedAt: sub.updatedAt,
      })),

      diagnosis: {
        hasActiveSubscription: Boolean(activeSubscription),
        totalSubscriptions: userSubscriptions.length,
        currentPlanSlug: activeSubscription?.plan.slug || 'none',
        expectedPlanSlug: 'enterprise',
        isCorrectPlan: activeSubscription?.plan.slug === 'enterprise',
      },
    });
  } catch (error) {
    console.error('Debug subscription status error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch subscription status',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

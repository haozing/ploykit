import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userEntitlements, entitlementPlans, user as betterAuthUser } from '@/lib/db/schema';
import { eq, sql, and, or, like } from 'drizzle-orm';
import { formatDistanceToNow, format } from 'date-fns';

/**
 * GET /api/admin/entitlements/users
 *
 * Get user entitlements (user subscriptions) with plan details
 *
 * Query params:
 * - search: string (search by user name or email)
 * - planId: string (filter by plan)
 * - status: string (filter by status: active, trial, expired, cancelled)
 * - page: number (pagination)
 * - limit: number (items per page)
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async (request: Request) => {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const planId = searchParams.get('planId') || '';
    const status = searchParams.get('status') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions = [];

    if (status && status !== 'all') {
      conditions.push(eq(userEntitlements.status, status));
    }

    if (planId && planId !== 'all') {
      conditions.push(eq(userEntitlements.planId, planId));
    }

    // Search filter (if provided)
    if (search) {
      conditions.push(
        or(like(betterAuthUser.name, `%${search}%`), like(betterAuthUser.email, `%${search}%`))
      );
    }

    // Get entitlements with joins
    const query = db
      .select({
        id: userEntitlements.id,
        userId: userEntitlements.userId,
        planId: userEntitlements.planId,
        status: userEntitlements.status,
        billingInterval: userEntitlements.billingInterval,
        startDate: userEntitlements.startDate,
        endDate: userEntitlements.endDate,
        usageMetrics: userEntitlements.usageMetrics,
        usageUpdatedAt: userEntitlements.usageUpdatedAt,
        notes: userEntitlements.notes,
        createdAt: userEntitlements.createdAt,
        updatedAt: userEntitlements.updatedAt,
        userName: betterAuthUser.name,
        userEmail: betterAuthUser.email,
        planName: entitlementPlans.name,
        planSlug: entitlementPlans.slug,
        planPricing: entitlementPlans.pricing,
        planLangJsonb: entitlementPlans.langJsonb,
        planLimits: entitlementPlans.limits,
      })
      .from(userEntitlements)
      .leftJoin(betterAuthUser, eq(userEntitlements.userId, betterAuthUser.id))
      .leftJoin(entitlementPlans, eq(userEntitlements.planId, entitlementPlans.id))
      .$dynamic();

    // Apply filters
    const queryWithFilters = conditions.length > 0 ? query.where(and(...conditions)) : query;

    // Execute query with pagination
    const entitlements = await queryWithFilters
      .orderBy(userEntitlements.createdAt)
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(userEntitlements)
      .leftJoin(betterAuthUser, eq(userEntitlements.userId, betterAuthUser.id));

    const countResult = await (conditions.length > 0
      ? countQuery.where(and(...conditions))
      : countQuery);

    const total = Number(countResult[0]?.count || 0);

    // Format the data for frontend
    const formattedEntitlements = entitlements.map((ent) => {
      const startDate = new Date(ent.startDate);
      const endDate = ent.endDate ? new Date(ent.endDate) : null;

      // Calculate days remaining or elapsed
      let daysInfo = '';
      if (endDate) {
        const now = new Date();
        const diffTime = endDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays > 0) {
          daysInfo = `${diffDays} days remaining`;
        } else if (diffDays === 0) {
          daysInfo = 'Expires today';
        } else {
          daysInfo = `Expired ${Math.abs(diffDays)} days ago`;
        }
      } else {
        daysInfo = 'No expiration';
      }

      return {
        id: ent.id,
        userId: ent.userId,
        userName: ent.userName || 'Unknown User',
        userEmail: ent.userEmail || 'No email',
        billingInterval: ent.billingInterval,
        plan: {
          id: ent.planId,
          name: ent.planName || 'Unknown Plan',
          slug: ent.planSlug || '',
          pricing: ent.planPricing,
          langJsonb: ent.planLangJsonb,
          limits: ent.planLimits,
        },
        status: ent.status,
        startDate: format(startDate, 'MMM dd, yyyy'),
        startDateRaw: ent.startDate,
        endDate: endDate ? format(endDate, 'MMM dd, yyyy') : 'No end date',
        endDateRaw: ent.endDate,
        daysInfo,
        usageMetrics: ent.usageMetrics || {},
        usageUpdatedAt: ent.usageUpdatedAt,
        notes: ent.notes,
        createdAgo: formatDistanceToNow(new Date(ent.createdAt), { addSuffix: true }),
        createdAt: ent.createdAt,
        updatedAt: ent.updatedAt,
      };
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          entitlements: formattedEntitlements,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      },
      { status: 200 }
    );
  })
);

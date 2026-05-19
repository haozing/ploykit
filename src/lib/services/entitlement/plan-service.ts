import { db, withSystemContext } from '@/lib/db';
import { entitlementPlans, userEntitlements, type EntitlementPlan } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { NotFoundError, ConflictError, ForbiddenError } from '@/lib/_core/errors';
import { getRuntimeProductId } from '@/lib/plugin-runtime/product-id';
import { normalizePlanFeaturesForStorage } from '@/lib/entitlements/plan-capability-registry.server';
import {
  createPlanSchema,
  updatePlanSchema,
  planFiltersSchema,
  type CreatePlanInput,
  type UpdatePlanInput,
  type PlanFiltersInput,
} from '@/lib/validations';
import { countAll, countWhere } from '@/lib/helpers';

/**
 * Plan Service
 *
 * Business logic for subscription plan management:
 * - List plans with sorting
 * - Get plan details
 * - Create, update, delete plans
 * - Plan activation/deactivation
 */

// Re-export types from schema for convenience
export type { PlanFeatures, PlanLimits } from '@/lib/db/schema';

/**
 * Plan with additional computed fields
 */
export interface PlanWithDetails extends EntitlementPlan {
  subscriberCount?: number;
}

function normalizePlanLimits(input: unknown): {
  monthly: Record<string, number>;
  yearly: Record<string, number>;
} {
  const value =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return {
    monthly: (value.monthly as Record<string, number> | undefined) || {},
    yearly: (value.yearly as Record<string, number> | undefined) || {},
  };
}

/**
 * Get subscriber counts for all plans
 * @internal
 */
async function getSubscriberCounts(): Promise<Map<string, number>> {
  const counts = await db
    .select({
      planId: userEntitlements.planId,
      count: sql<number>`count(*)::int`,
    })
    .from(userEntitlements)
    .where(eq(userEntitlements.status, 'active'))
    .groupBy(userEntitlements.planId);

  return new Map(counts.map((c) => [c.planId, c.count]));
}

/**
 * Get subscriber count for a single plan
 * @internal
 */
async function getSubscriberCount(planId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userEntitlements)
    .where(and(eq(userEntitlements.planId, planId), eq(userEntitlements.status, 'active')));

  return result[0]?.count ?? 0;
}

/**
 * List all plans
 */
export async function listPlans(filters: PlanFiltersInput = {}): Promise<PlanWithDetails[]> {
  // Validate input
  const validatedFilters = planFiltersSchema.parse(filters);
  const { isActive } = validatedFilters;
  const productId = validatedFilters.productId ?? getRuntimeProductId();

  // Build where clause
  const whereClause = and(
    eq(entitlementPlans.productId, productId),
    typeof isActive === 'boolean' ? eq(entitlementPlans.isActive, isActive) : undefined
  );

  // Execute queries in parallel
  const [plans, subscriberCounts] = await Promise.all([
    db.select().from(entitlementPlans).where(whereClause).orderBy(entitlementPlans.sortOrder),
    getSubscriberCounts(),
  ]);

  // Attach subscriber counts to plans
  return plans.map((plan) => ({
    ...plan,
    subscriberCount: subscriberCounts.get(plan.id) ?? 0,
  }));
}

/**
 * Get plan by ID
 */
export async function getPlanById(planId: string): Promise<PlanWithDetails | null> {
  const plan = await db.query.entitlementPlans.findFirst({
    where: eq(entitlementPlans.id, planId),
  });

  if (!plan) {
    return null;
  }

  // Get subscriber count
  const subscriberCount = await getSubscriberCount(planId);
  return { ...plan, subscriberCount };
}

/**
 * Get plan by slug
 */
export async function getPlanBySlug(slug: string): Promise<PlanWithDetails | null> {
  return getPlanBySlugForProduct(slug, getRuntimeProductId());
}

/**
 * Get plan by slug within a runtime product
 */
export async function getPlanBySlugForProduct(
  slug: string,
  productId: string
): Promise<PlanWithDetails | null> {
  const plan = await db.query.entitlementPlans.findFirst({
    where: and(eq(entitlementPlans.productId, productId), eq(entitlementPlans.slug, slug)),
  });

  if (!plan) {
    return null;
  }

  const subscriberCount = await getSubscriberCount(plan.id);
  return { ...plan, subscriberCount };
}

/**
 * Get default plan
 */
export async function getDefaultPlan(): Promise<PlanWithDetails | null> {
  return getDefaultPlanForProduct(getRuntimeProductId());
}

/**
 * Get default plan within a runtime product
 */
export async function getDefaultPlanForProduct(productId: string): Promise<PlanWithDetails | null> {
  const plan = await db.query.entitlementPlans.findFirst({
    where: and(eq(entitlementPlans.productId, productId), eq(entitlementPlans.isDefault, true)),
  });

  if (!plan) {
    return null;
  }

  const subscriberCount = await getSubscriberCount(plan.id);
  return { ...plan, subscriberCount };
}

/**
 * Create a new plan
 */
export async function createPlan(data: CreatePlanInput) {
  // Validate input
  const validatedData = createPlanSchema.parse(data);
  const productId = validatedData.productId ?? getRuntimeProductId();

  const limitsToStore = normalizePlanLimits(validatedData.limits);
  const featuresToStore = normalizePlanFeaturesForStorage(validatedData.features ?? {}, {
    productId,
  });

  const pricingInput = (validatedData.pricing || {}) as Record<string, unknown>;
  const pricingToStore = {
    currency: (pricingInput.currency as string | undefined) || 'USD',
    monthly: typeof pricingInput.monthly === 'number' ? pricingInput.monthly : undefined,
    yearly: typeof pricingInput.yearly === 'number' ? pricingInput.yearly : undefined,
  } as Record<string, unknown>;

  // Check if slug already exists
  const existing = await getPlanBySlugForProduct(validatedData.slug, productId);

  if (existing) {
    throw new ConflictError('Plan slug already exists', {
      slug: validatedData.slug,
      existingId: existing.id,
    });
  }

  const [newPlan] = await db
    .insert(entitlementPlans)
    .values({
      name: validatedData.name,
      productId,
      slug: validatedData.slug,
      features: featuresToStore,
      limits: limitsToStore,
      pricing: pricingToStore,
      stripe: validatedData.stripe ?? {},
      langJsonb: validatedData.langJsonb ?? null,
      sortOrder: validatedData.sortOrder || 0,
      isActive: validatedData.isActive ?? true,
      isDefault: validatedData.isDefault || false,
      isPopular: validatedData.isPopular ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return newPlan as PlanWithDetails;
}

/**
 * Update plan information
 */
export async function updatePlan(planId: string, data: UpdatePlanInput) {
  // Validate input
  const validatedData = updatePlanSchema.parse(data);

  const existingPlan = await getPlanById(planId);

  if (!existingPlan) {
    throw new NotFoundError('Plan', planId);
  }

  // If slug is being changed, check for conflicts
  if (validatedData.slug && validatedData.slug !== existingPlan.slug) {
    const slugExists = await getPlanBySlugForProduct(validatedData.slug, existingPlan.productId);

    if (slugExists) {
      throw new ConflictError('Plan slug already exists', {
        slug: validatedData.slug,
        existingId: slugExists.id,
      });
    }
  }

  const { limits, pricing, stripe, langJsonb, features, ...restData } = validatedData;

  const updateData: Record<string, unknown> = {
    ...restData,
    updatedAt: new Date(),
  };

  if (limits !== undefined) {
    updateData.limits = normalizePlanLimits(limits);
  }

  if (features !== undefined) {
    updateData.features = normalizePlanFeaturesForStorage(features, {
      productId: existingPlan.productId,
    });
  }

  if (pricing !== undefined) {
    updateData.pricing = pricing;
  }

  if (stripe !== undefined) {
    updateData.stripe = stripe;
  }

  if (langJsonb !== undefined) {
    updateData.langJsonb = langJsonb;
  }

  const [updatedPlan] = await db
    .update(entitlementPlans)
    .set(updateData)
    .where(eq(entitlementPlans.id, planId))
    .returning();

  return updatedPlan as PlanWithDetails;
}

/**
 * Delete plan
 *
 */
export async function deletePlan(planId: string) {
  await withSystemContext(async (db) => {
    return db.transaction(async (tx) => {
      // ?Step 1: Check plan exists and lock the row
      const plan = await tx
        .select()
        .from(entitlementPlans)
        .where(eq(entitlementPlans.id, planId))
        .for('update')
        .limit(1);

      if (!plan || plan.length === 0) {
        throw new NotFoundError('Plan', planId);
      }

      if (plan[0].isDefault) {
        throw new ForbiddenError('Cannot delete default plan', {
          planId,
          isDefault: true,
        });
      }

      // ?Step 2: Check for active subscriptions
      const activeCount = await tx
        .select({ count: sql<number>`count(*)` })
        .from(userEntitlements)
        .where(and(eq(userEntitlements.planId, planId), eq(userEntitlements.status, 'active')));

      const count = Number(activeCount[0]?.count || 0);
      if (count > 0) {
        throw new ForbiddenError(
          `Cannot delete plan with ${count} active subscription${count > 1 ? 's' : ''}`,
          { planId, activeSubscriptions: count }
        );
      }

      // ?Step 3: Delete the plan
      await tx.delete(entitlementPlans).where(eq(entitlementPlans.id, planId));
    });
  });

  return { success: true };
}

/**
 * Set plan as default
 *
 */
export async function setDefaultPlan(planId: string) {
  const updatedPlan = await withSystemContext(async (db) => {
    return db.transaction(async (tx) => {
      const targetPlan = await tx
        .select()
        .from(entitlementPlans)
        .where(eq(entitlementPlans.id, planId))
        .for('update')
        .limit(1);

      if (!targetPlan[0]) {
        throw new NotFoundError('Plan', planId);
      }

      // ?Step 1: Remove default from sibling plans in the same product
      await tx
        .update(entitlementPlans)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(entitlementPlans.productId, targetPlan[0].productId),
            eq(entitlementPlans.isDefault, true)
          )
        );

      // ?Step 2: Set this plan as default
      const [updated] = await tx
        .update(entitlementPlans)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(entitlementPlans.id, planId))
        .returning();

      if (!updated) {
        throw new NotFoundError('Plan', planId);
      }

      return updated;
    });
    // ?Transaction ensures no time window without a default plan
  });

  return updatedPlan as PlanWithDetails;
}

/**
 * Get plan statistics
 */
export async function getPlanStats(productId = getRuntimeProductId()) {
  // Execute counts in parallel using helpers
  const [total, active] = await Promise.all([
    countAll(entitlementPlans, eq(entitlementPlans.productId, productId)),
    countWhere(
      entitlementPlans,
      and(eq(entitlementPlans.productId, productId), eq(entitlementPlans.isActive, true))!
    ),
  ]);

  return {
    total,
    active,
    inactive: total - active,
  };
}

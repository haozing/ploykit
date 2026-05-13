/**
 * Entitlement Schema (entitlementSubscribeSystem)
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { betterAuthuser } from './core';

// ============================================================================
// Type Definition
// ============================================================================

export type OutputResolution = '480p' | '720p' | '1080p' | '4k' | 'original';

/**
 * Plan features (machine-enforced capabilities/constraints).
 *
 * Conventions:
 * - Prefer namespaced keys: `${pluginId}.xxx` (e.g. `runlynk.outputResolution`)
 * - For boolean gated capabilities, use true/false
 * - For parameterized capabilities, use string/number (e.g. resolution enum)
 */
export interface PlanFeatures {
  'runlynk.outputResolution'?: OutputResolution;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for JSONB field flexibility in Drizzle ORM
  [key: string]: any;
}

/**
 * Plan usage limits (quota).
 */
export interface PlanLimits {
  /**
   * Limits are split by billing interval (monthly vs yearly), while quotas reset monthly.
   * Missing keys are treated as 0 (deny) by the quota enforcement logic.
   */
  monthly?: Record<string, number>;
  yearly?: Record<string, number>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for JSONB field flexibility in Drizzle ORM
  [key: string]: any;
}

export interface PlanPricing {
  currency?: string;
  monthly?: number;
  yearly?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSONB compatibility
  [key: string]: any;
}

export interface PlanStripeConfig {
  productId?: string | null;
  priceIdMonthly?: string | null;
  priceIdYearly?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSONB compatibility
  [key: string]: any;
}

/**
 * Multi-language plan display content.
 *
 * Note: This is display-only. Enforcement MUST use PlanFeatures/PlanLimits.
 */
export interface PlanTranslation {
  name?: string;
  description?: string;
  featuresList?: string[];
  buttonText?: string;
  highlightedText?: string;
}

export interface UserEntitlementUsageMetrics {
  lastUsedAt?: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for JSONB field flexibility in Drizzle ORM
  [key: string]: any;
}

// ============================================================================
// Tables
// ============================================================================

export const entitlementPlans = pgTable(
  'entitlement_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    name: text('name').notNull(),
    slug: text('slug').notNull(),

    features: jsonb('features').$type<PlanFeatures>().notNull().default({}),

    limits: jsonb('limits').$type<PlanLimits>().notNull().default({ monthly: {}, yearly: {} }),

    /** Structured pricing config (monthly/yearly amounts, currency, trial days). */
    pricing: jsonb('pricing').$type<PlanPricing>().notNull().default({}),

    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    isPopular: boolean('is_popular').notNull().default(false),

    metadata: jsonb('metadata').default({}),

    /** Stripe product/environment info (separate from price history mapping). */
    stripe: jsonb('stripe').$type<PlanStripeConfig>().notNull().default({}),

    /**
     * Multi-language support for plan content.
     * Structure: { "zh": { name, description, featuresList }, "en": { ... } }
     */
    langJsonb: jsonb('lang_jsonb').$type<Record<string, PlanTranslation> | null>(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex('entitlement_plans_slug_idx').on(table.slug),
    activeIdx: index('entitlement_plans_active_idx').on(table.isActive),
    sortIdx: index('entitlement_plans_sort_idx').on(table.sortOrder),
  })
);

export const userEntitlements = pgTable(
  'user_entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: text('user_id')
      .notNull()
      .references(() => betterAuthuser.id, { onDelete: 'cascade' }),

    planId: uuid('plan_id')
      .notNull()
      .references(() => entitlementPlans.id, { onDelete: 'restrict' }),

    status: text('status').notNull().default('active'),

    /**
     * Billing interval for this subscription (how the user pays).
     * Quotas reset monthly regardless of billing interval.
     */
    billingInterval: text('billing_interval').notNull().default('monthly'),

    startDate: timestamp('start_date', { withTimezone: true }).notNull().defaultNow(),
    endDate: timestamp('end_date', { withTimezone: true }),

    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    trialEndDate: timestamp('trial_end_date', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),

    quotaPeriodStart: timestamp('quota_period_start', { withTimezone: true }),
    quotaPeriodEnd: timestamp('quota_period_end', { withTimezone: true }),

    usageMetrics: jsonb('usage_metrics').$type<UserEntitlementUsageMetrics>().notNull().default({}),
    usageUpdatedAt: timestamp('usage_updated_at', { withTimezone: true }),

    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionStatus: text('stripe_subscription_status'),

    metadata: jsonb('metadata').default({}),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('user_entitlements_user_idx').on(table.userId),
    userStatusIdx: index('user_entitlements_user_status_idx').on(table.userId, table.status),
    planIdx: index('user_entitlements_plan_idx').on(table.planId),
    statusIdx: index('user_entitlements_status_idx').on(table.status),
    endDateIdx: index('user_entitlements_end_date_idx').on(table.endDate),
    stripeSubscriptionIdx: index('user_entitlements_stripe_subscription_idx').on(
      table.stripeSubscriptionId
    ),
    billingIntervalIdx: index('user_entitlements_billing_interval_idx').on(table.billingInterval),
  })
);

export const usageHistory = pgTable(
  'usage_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    idempotencyKey: text('idempotency_key').notNull(),

    userId: text('user_id')
      .notNull()
      .references(() => betterAuthuser.id, { onDelete: 'cascade' }),

    pluginId: text('plugin_id').notNull(),
    metric: text('metric').notNull(),
    value: integer('value').notNull(),
    unit: text('unit').notNull().default('count'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),

    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    idempotencyKeyIdx: uniqueIndex('usage_history_idempotency_key_idx').on(table.idempotencyKey),
    userPluginMetricTimeIdx: index('usage_history_user_plugin_metric_time_idx').on(
      table.userId,
      table.pluginId,
      table.metric,
      table.recordedAt
    ),
    userIdx: index('usage_history_user_idx').on(table.userId),
    pluginIdx: index('usage_history_plugin_idx').on(table.pluginId),
    userPluginIdx: index('usage_history_user_plugin_idx').on(table.userId, table.pluginId),
    recordedAtIdx: index('usage_history_recorded_at_idx').on(table.recordedAt),
  })
);

// ============================================================================
// Relations
// ============================================================================

export const entitlementPlansRelations = relations(entitlementPlans, ({ many }) => ({
  userEntitlements: many(userEntitlements),
}));

export const userEntitlementsRelations = relations(userEntitlements, ({ one }) => ({
  user: one(betterAuthuser, {
    fields: [userEntitlements.userId],
    references: [betterAuthuser.id],
  }),
  plan: one(entitlementPlans, {
    fields: [userEntitlements.planId],
    references: [entitlementPlans.id],
  }),
}));

export const usageHistoryRelations = relations(usageHistory, ({ one }) => ({
  user: one(betterAuthuser, {
    fields: [usageHistory.userId],
    references: [betterAuthuser.id],
  }),
}));

// ============================================================================
// Type Export
// ============================================================================

export type EntitlementPlan = typeof entitlementPlans.$inferSelect;
export type NewEntitlementPlan = typeof entitlementPlans.$inferInsert;

export type UserEntitlement = typeof userEntitlements.$inferSelect;
export type NewUserEntitlement = typeof userEntitlements.$inferInsert;

export type UsageHistoryRecord = typeof usageHistory.$inferSelect;
export type NewUsageHistoryRecord = typeof usageHistory.$inferInsert;

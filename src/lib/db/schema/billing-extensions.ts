/**
 * Billing Extensions Schema
 *
 * Additional tables for enhanced billing and subscription management:
 * - orders: Complete transaction history
 * - creditLogs: Credit/quota change history for user transparency
 *
 * These tables complement the existing entitlement schema with:
 * 1. Full audit trail for all payment transactions
 * 2. User-visible credit change history
 * 3. Idempotency support for webhook processing
 * 4. Refund tracking and reconciliation
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  numeric,
  integer,
  bigserial,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { betterAuthuser } from './core';
import { entitlementPlans, userEntitlements } from './entitlement';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Order Types
 *
 * Tracks different types of billing transactions
 */
export type OrderType =
  | 'subscription_created' // Initial subscription purchase
  | 'subscription_renewed' // Subscription renewal/billing cycle
  | 'subscription_cancelled' // Subscription cancellation
  | 'one_time_purchase' // One-time payment (if supported)
  | 'refund'; // Refund transaction

/**
 * Order Status
 *
 * Payment processing status
 */
export type OrderStatus =
  | 'pending' // Payment initiated
  | 'succeeded' // Payment successful
  | 'failed' // Payment failed
  | 'refunded' // Order refunded
  | 'partially_refunded'; // Partial refund

/**
 * Credit Log Types
 *
 * Different types of credit/quota changes
 * Note: We only log important events, NOT every API call
 */
export type CreditLogType =
  | 'grant' // Credits granted (subscription created/renewed)
  | 'reset' // Monthly/billing cycle reset
  | 'refund_revoke' // Credits revoked due to refund
  | 'manual_adjust' // Manual adjustment by admin
  | 'subscription_upgrade' // Plan upgrade
  | 'subscription_downgrade'; // Plan downgrade

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible' | 'refunded';

export type PaymentMethodStatus = 'active' | 'expired' | 'removed';

export type TaxProfileStatus = 'active' | 'archived';

export type DigitalEntitlementStatus = 'active' | 'revoked' | 'expired';

export type DigitalEntitlementSourceType = 'one_time_purchase' | 'manual' | 'refund' | 'import';

// ============================================================================
// ORDERS TABLE
// ============================================================================

/**
 * Orders Table
 *
 * Complete transaction history for all payment events.
 *
 * Key Features:
 * - Idempotency: Uses providerOrderId to prevent duplicate processing
 * - Audit Trail: Complete record of all transactions
 * - Refund Tracking: Links refunds to original orders via relatedOrderId
 * - Multi-Provider: Supports multiple payment providers (Stripe, Paddle, etc.)
 *
 * @example Query user's order history
 * ```ts
 * const orders = await db.query.orders.findMany({
 *   where: eq(orders.userId, userId),
 *   orderBy: desc(orders.createdAt)
 * });
 * ```
 *
 * @example Check if order already processed (idempotency)
 * ```ts
 * const existing = await db.query.orders.findFirst({
 *   where: eq(orders.providerOrderId, stripeInvoiceId)
 * });
 * if (existing) return; // Already processed
 * ```
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // User who made the purchase
    userId: text('user_id')
      .notNull()
      .references(() => betterAuthuser.id, { onDelete: 'cascade' }),

    // Transaction type
    orderType: text('order_type').$type<OrderType>().notNull(),

    // Payment provider details
    provider: text('provider').default('stripe').notNull(), // 'stripe' | 'paddle' | 'paypal'
    providerOrderId: text('provider_order_id').notNull(), // Stripe Invoice ID, Payment Intent ID, etc.

    // Financial details
    amount: numeric('amount', { precision: 10, scale: 2 }),
    currency: text('currency').default('USD'),
    status: text('status').$type<OrderStatus>().notNull(),

    // Associated plan
    planId: uuid('plan_id').references(() => entitlementPlans.id, { onDelete: 'set null' }),

    // For refunds: link to original order (relation defined below)
    relatedOrderId: uuid('related_order_id'),

    // Additional data (Stripe invoice object, etc.)
    metadata: jsonb('metadata').default({}),

    // Audit timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Fast user order history lookup
    userIdIdx: index('orders_user_id_idx').on(table.userId),

    // Idempotency: ensure we don't process the same provider order twice
    providerOrderIdIdx: uniqueIndex('orders_provider_order_id_idx').on(
      table.provider,
      table.providerOrderId
    ),

    // Filter by order type
    orderTypeIdx: index('orders_order_type_idx').on(table.orderType),

    // Query by status
    statusIdx: index('orders_status_idx').on(table.status),

    // Time-based queries (recent orders, etc.)
    createdAtIdx: index('orders_created_at_idx').on(table.createdAt.desc()),

    // Plan analytics
    planIdIdx: index('orders_plan_id_idx').on(table.planId),

    // Refund tracking
    relatedOrderIdIdx: index('orders_related_order_id_idx').on(table.relatedOrderId),
  })
);

// ============================================================================
// LOCAL INVOICES / PAYMENT METHODS / TAX PROFILE TABLES
// ============================================================================

export const billingInvoices = pgTable(
  'billing_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => betterAuthuser.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    provider: text('provider').default('local').notNull(),
    providerInvoiceId: text('provider_invoice_id'),
    invoiceNumber: text('invoice_number').notNull(),
    status: text('status').$type<InvoiceStatus>().notNull().default('open'),
    currency: text('currency').default('USD').notNull(),
    subtotalAmount: numeric('subtotal_amount', { precision: 10, scale: 2 }).default('0').notNull(),
    taxAmount: numeric('tax_amount', { precision: 10, scale: 2 }).default('0').notNull(),
    totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).default('0').notNull(),
    hostedUrl: text('hosted_url'),
    pdfUrl: text('pdf_url'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('billing_invoices_user_id_idx').on(table.userId),
    orderIdx: index('billing_invoices_order_id_idx').on(table.orderId),
    statusIdx: index('billing_invoices_status_idx').on(table.status),
    issuedAtIdx: index('billing_invoices_issued_at_idx').on(table.issuedAt.desc()),
    invoiceNumberIdx: uniqueIndex('billing_invoices_invoice_number_idx').on(table.invoiceNumber),
    providerInvoiceIdx: uniqueIndex('billing_invoices_provider_invoice_idx')
      .on(table.provider, table.providerInvoiceId)
      .where(sql`${table.providerInvoiceId} IS NOT NULL`),
  })
);

export const billingPaymentMethods = pgTable(
  'billing_payment_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => betterAuthuser.id, { onDelete: 'cascade' }),
    provider: text('provider').default('local').notNull(),
    providerPaymentMethodId: text('provider_payment_method_id'),
    type: text('type').notNull(),
    brand: text('brand'),
    last4: text('last4'),
    expMonth: integer('exp_month'),
    expYear: integer('exp_year'),
    billingName: text('billing_name'),
    billingEmail: text('billing_email'),
    billingCountry: text('billing_country'),
    status: text('status').$type<PaymentMethodStatus>().notNull().default('active'),
    isDefault: boolean('is_default').notNull().default(false),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('billing_payment_methods_user_id_idx').on(table.userId),
    statusIdx: index('billing_payment_methods_status_idx').on(table.status),
    defaultIdx: index('billing_payment_methods_default_idx').on(table.userId, table.isDefault),
    providerPaymentMethodIdx: uniqueIndex('billing_payment_methods_provider_id_idx')
      .on(table.provider, table.providerPaymentMethodId)
      .where(sql`${table.providerPaymentMethodId} IS NOT NULL`),
  })
);

export const billingTaxProfiles = pgTable(
  'billing_tax_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => betterAuthuser.id, { onDelete: 'cascade' }),
    legalName: text('legal_name'),
    taxId: text('tax_id'),
    taxIdType: text('tax_id_type'),
    country: text('country').notNull(),
    region: text('region'),
    city: text('city'),
    postalCode: text('postal_code'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    status: text('status').$type<TaxProfileStatus>().notNull().default('active'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('billing_tax_profiles_user_id_idx').on(table.userId),
    statusIdx: index('billing_tax_profiles_status_idx').on(table.status),
    countryIdx: index('billing_tax_profiles_country_idx').on(table.country),
  })
);

// ============================================================================
// CREDIT LOGS TABLE
// ============================================================================

/**
 * Credit Logs Table
 *
 * Tracks important credit/quota changes for user transparency.
 *
 * Important: We only log significant events, NOT every API call:
 * - ✅ Log: Subscription created/renewed, monthly reset, refunds, manual adjustments
 * - ❌ Don't Log: Individual API calls (would generate millions of rows)
 *
 * For detailed API call logs, consider using a time-series database like ClickHouse.
 *
 * Key Features:
 * - User Transparency: Users can view their credit history
 * - Dispute Resolution: Complete audit trail for support
 * - Compliance: Evidence for billing disputes
 *
 * @example Log subscription creation
 * ```ts
 * await db.insert(creditLogs).values({
 *   userId,
 *   logType: 'grant',
 *   changeAmount: 10000,
 *   balanceAfter: { apiCallsRemaining: 10000 },
 *   reason: 'Subscription created',
 *   relatedOrderId: orderId
 * });
 * ```
 *
 * @example Query user's credit history
 * ```ts
 * const logs = await db.query.creditLogs.findMany({
 *   where: eq(creditLogs.userId, userId),
 *   orderBy: desc(creditLogs.createdAt),
 *   limit: 50
 * });
 * ```
 */
export const creditLogs = pgTable(
  'credit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Immutable monotonic ledger number for financial-grade reconciliation.
    ledgerSequence: bigserial('ledger_sequence', { mode: 'number' }).notNull(),

    // User whose credits changed
    userId: text('user_id')
      .notNull()
      .references(() => betterAuthuser.id, { onDelete: 'cascade' }),

    // Type of change
    logType: text('log_type').$type<CreditLogType>().notNull(),

    // Amount changed (positive = added, negative = removed)
    changeAmount: integer('change_amount').notNull(),

    // Snapshot of balance after this change
    // Format: { apiCallsRemaining: 8750, lastResetAt: "2025-11-24" }
    balanceAfter: jsonb('balance_after').notNull(),
    balanceBefore: jsonb('balance_before'),
    balanceDelta: jsonb('balance_delta'),

    // Human-readable reason
    reason: text('reason'), // "Monthly reset" | "Subscription created" | "Refund" | etc.

    // Link to related order (if applicable)
    relatedOrderId: uuid('related_order_id').references(() => orders.id, { onDelete: 'set null' }),

    // Link to entitlement (if applicable)
    entitlementId: uuid('entitlement_id').references(() => userEntitlements.id, {
      onDelete: 'set null',
    }),

    // Additional context
    metadata: jsonb('metadata').default({}),
    checksum: text('checksum'),

    // When this change occurred
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Fast user credit history lookup
    userIdIdx: index('credit_logs_user_id_idx').on(table.userId),
    ledgerSequenceIdx: uniqueIndex('credit_logs_ledger_sequence_idx').on(table.ledgerSequence),

    // Most recent changes first
    createdAtIdx: index('credit_logs_created_at_idx').on(table.createdAt.desc()),

    // Filter by log type
    logTypeIdx: index('credit_logs_log_type_idx').on(table.logType),

    // Composite index for user's recent history
    userCreatedAtIdx: index('credit_logs_user_created_at_idx').on(
      table.userId,
      table.createdAt.desc()
    ),

    // Link to orders for reconciliation
    relatedOrderIdIdx: index('credit_logs_related_order_id_idx').on(table.relatedOrderId),
  })
);

export const creditReconciliationRuns = pgTable(
  'credit_reconciliation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: text('status').notNull().default('running'),
    checkedUsers: integer('checked_users').notNull().default(0),
    mismatchCount: integer('mismatch_count').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    error: text('error'),
    report: jsonb('report').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index('credit_reconciliation_runs_status_idx').on(table.status),
    startedAtIdx: index('credit_reconciliation_runs_started_at_idx').on(table.startedAt.desc()),
  })
);

export const digitalEntitlements = pgTable(
  'digital_entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => betterAuthuser.id, { onDelete: 'cascade' }),
    pluginId: text('plugin_id'),
    entitlementKey: text('entitlement_key').notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    status: text('status').$type<DigitalEntitlementStatus>().notNull().default('active'),
    sourceType: text('source_type')
      .$type<DigitalEntitlementSourceType>()
      .notNull()
      .default('manual'),
    metadata: jsonb('metadata').default({}),
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userKeyIdx: index('digital_entitlements_user_key_idx').on(table.userId, table.entitlementKey),
    pluginKeyIdx: index('digital_entitlements_plugin_key_idx').on(
      table.pluginId,
      table.entitlementKey
    ),
    orderIdx: index('digital_entitlements_order_idx').on(table.orderId),
    activePluginUniqueIdx: uniqueIndex('digital_entitlements_active_plugin_unique_idx')
      .on(table.userId, table.pluginId, table.entitlementKey)
      .where(
        sql`${table.status} = 'active' AND ${table.revokedAt} IS NULL AND ${table.pluginId} IS NOT NULL`
      ),
    activeGlobalUniqueIdx: uniqueIndex('digital_entitlements_active_global_unique_idx')
      .on(table.userId, table.entitlementKey)
      .where(
        sql`${table.status} = 'active' AND ${table.revokedAt} IS NULL AND ${table.pluginId} IS NULL`
      ),
  })
);

// ============================================================================
// RELATIONS
// ============================================================================

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(betterAuthuser, {
    fields: [orders.userId],
    references: [betterAuthuser.id],
  }),

  plan: one(entitlementPlans, {
    fields: [orders.planId],
    references: [entitlementPlans.id],
  }),

  // For refunds: link to original order
  relatedOrder: one(orders, {
    fields: [orders.relatedOrderId],
    references: [orders.id],
  }),

  // Credit logs associated with this order
  creditLogs: many(creditLogs),

  invoices: many(billingInvoices),
}));

export const billingInvoicesRelations = relations(billingInvoices, ({ one }) => ({
  user: one(betterAuthuser, {
    fields: [billingInvoices.userId],
    references: [betterAuthuser.id],
  }),
  order: one(orders, {
    fields: [billingInvoices.orderId],
    references: [orders.id],
  }),
}));

export const billingPaymentMethodsRelations = relations(billingPaymentMethods, ({ one }) => ({
  user: one(betterAuthuser, {
    fields: [billingPaymentMethods.userId],
    references: [betterAuthuser.id],
  }),
}));

export const billingTaxProfilesRelations = relations(billingTaxProfiles, ({ one }) => ({
  user: one(betterAuthuser, {
    fields: [billingTaxProfiles.userId],
    references: [betterAuthuser.id],
  }),
}));

export const creditLogsRelations = relations(creditLogs, ({ one }) => ({
  user: one(betterAuthuser, {
    fields: [creditLogs.userId],
    references: [betterAuthuser.id],
  }),

  relatedOrder: one(orders, {
    fields: [creditLogs.relatedOrderId],
    references: [orders.id],
  }),

  entitlement: one(userEntitlements, {
    fields: [creditLogs.entitlementId],
    references: [userEntitlements.id],
  }),
}));

export const digitalEntitlementsRelations = relations(digitalEntitlements, ({ one }) => ({
  user: one(betterAuthuser, {
    fields: [digitalEntitlements.userId],
    references: [betterAuthuser.id],
  }),
  order: one(orders, {
    fields: [digitalEntitlements.orderId],
    references: [orders.id],
  }),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export type BillingInvoice = typeof billingInvoices.$inferSelect;
export type NewBillingInvoice = typeof billingInvoices.$inferInsert;

export type BillingPaymentMethod = typeof billingPaymentMethods.$inferSelect;
export type NewBillingPaymentMethod = typeof billingPaymentMethods.$inferInsert;

export type BillingTaxProfile = typeof billingTaxProfiles.$inferSelect;
export type NewBillingTaxProfile = typeof billingTaxProfiles.$inferInsert;

export type CreditLog = typeof creditLogs.$inferSelect;
export type NewCreditLog = typeof creditLogs.$inferInsert;

export type CreditReconciliationRun = typeof creditReconciliationRuns.$inferSelect;
export type NewCreditReconciliationRun = typeof creditReconciliationRuns.$inferInsert;

export type DigitalEntitlement = typeof digitalEntitlements.$inferSelect;
export type NewDigitalEntitlement = typeof digitalEntitlements.$inferInsert;

/**
 * Webhook schema.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const webhookLogs = pgTable(
  'webhook_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    provider: text('provider').notNull(),
    eventId: text('event_id'),
    eventType: text('event_type').notNull(),

    payload: jsonb('payload').notNull(),
    signature: text('signature'),
    headers: jsonb('headers'),

    status: text('status').notNull().default('received'),
    internalEvents: jsonb('internal_events').$type<string[]>(),

    error: text('error'),
    processingTime: integer('processing_time'),
    retryCount: integer('retry_count').default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => ({
    providerIdx: index('webhook_logs_provider_idx').on(table.provider),
    statusIdx: index('webhook_logs_status_idx').on(table.status),
    eventTypeIdx: index('webhook_logs_event_type_idx').on(table.eventType),
    createdAtIdx: index('webhook_logs_created_at_idx').on(table.createdAt),
    eventIdIdx: index('webhook_logs_event_id_idx').on(table.provider, table.eventId),
    providerEventIdUniqueIdx: uniqueIndex('webhook_logs_provider_event_id_unique_idx')
      .on(table.provider, table.eventId)
      .where(sql`${table.eventId} IS NOT NULL`),
    statusUpdatedAtIdx: index('webhook_logs_status_updated_at_idx').on(
      table.status,
      table.updatedAt
    ),
  })
);

export const webhookRetries = pgTable(
  'webhook_retries',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    webhookLogId: uuid('webhook_log_id')
      .notNull()
      .references(() => webhookLogs.id, { onDelete: 'cascade' }),

    attempt: integer('attempt').notNull(),
    status: text('status').notNull(),
    error: text('error'),

    retriedAt: timestamp('retried_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    webhookLogIdx: index('webhook_retries_webhook_log_idx').on(table.webhookLogId),
    retriedAtIdx: index('webhook_retries_retried_at_idx').on(table.retriedAt),
  })
);

export type WebhookLog = typeof webhookLogs.$inferSelect;
export type NewWebhookLog = typeof webhookLogs.$inferInsert;

export type WebhookRetry = typeof webhookRetries.$inferSelect;
export type NewWebhookRetry = typeof webhookRetries.$inferInsert;

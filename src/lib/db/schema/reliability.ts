/**
 * Reliability Schema
 *
 * Durable infrastructure tables for critical event delivery.
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';

export type EventOutboxStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'ignored'
  | 'archived';

export interface EventOutboxMetadata {
  emitterId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export const eventOutbox = pgTable(
  'event_outbox',
  {
    id: text('id').primaryKey(),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull().default({}),
    metadata: jsonb('metadata').$type<EventOutboxMetadata>().notNull().default({}),

    status: text('status').$type<EventOutboxStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    error: text('error'),

    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statusNextAttemptIdx: index('event_outbox_status_next_attempt_idx').on(
      table.status,
      table.nextAttemptAt
    ),
    eventStatusIdx: index('event_outbox_event_status_idx').on(table.event, table.status),
    createdAtIdx: index('event_outbox_created_at_idx').on(table.createdAt),
  })
);

export type PluginJobRunStatus = 'running' | 'succeeded' | 'dead_letter';

export const pluginJobRuns = pgTable(
  'plugin_job_runs',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull().default(''),
    jobName: text('job_name').notNull(),
    status: text('status').$type<PluginJobRunStatus>().notNull().default('running'),
    priority: text('priority').notNull().default('normal'),
    payload: jsonb('payload').$type<unknown>().notNull().default({}),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(1),
    idempotencyKey: text('idempotency_key'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pluginStatusIdx: index('plugin_job_runs_plugin_status_idx').on(table.pluginId, table.status),
    jobStartedIdx: index('plugin_job_runs_job_started_idx').on(table.jobName, table.startedAt),
    startedAtIdx: index('plugin_job_runs_started_at_idx').on(table.startedAt),
    idempotencyIdx: uniqueIndex('plugin_job_runs_idempotency_key_idx').on(table.idempotencyKey),
  })
);

export const edgeAccessLogs = pgTable(
  'edge_access_logs',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull().default('api_gateway'),
    requestId: text('request_id'),
    method: text('method').notNull(),
    path: text('path').notNull(),
    statusCode: integer('status_code').notNull(),
    durationMs: integer('duration_ms'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id'),
    apiKeyId: text('api_key_id'),
    region: text('region'),
    failureType: text('failure_type'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    occurredAtIdx: index('edge_access_logs_occurred_at_idx').on(table.occurredAt.desc()),
    sourceIdx: index('edge_access_logs_source_idx').on(table.source),
    statusIdx: index('edge_access_logs_status_idx').on(table.statusCode),
    failureTypeIdx: index('edge_access_logs_failure_type_idx').on(table.failureType),
    pathIdx: index('edge_access_logs_path_idx').on(table.path),
    requestIdIdx: uniqueIndex('edge_access_logs_request_id_idx')
      .on(table.source, table.requestId)
      .where(sql`${table.requestId} IS NOT NULL`),
  })
);

export type EventOutboxEntry = typeof eventOutbox.$inferSelect;
export type NewEventOutboxEntry = typeof eventOutbox.$inferInsert;

export type PluginJobRunEntry = typeof pluginJobRuns.$inferSelect;
export type NewPluginJobRunEntry = typeof pluginJobRuns.$inferInsert;

export type EdgeAccessLogEntry = typeof edgeAccessLogs.$inferSelect;
export type NewEdgeAccessLogEntry = typeof edgeAccessLogs.$inferInsert;

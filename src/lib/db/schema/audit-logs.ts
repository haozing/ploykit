/**
 * Audit Logs Schema
 *
 * User-level audit log schema.
 */

import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

/**
 * Metadata structure for audit log entries
 */
export interface AuditLogMetadata {
  // State change details
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;

  // Request information
  requestId?: string;
  requestMethod?: string;
  requestPath?: string;

  // Additional context
  reason?: string;
  duration?: number; // Duration in milliseconds
  additionalInfo?: Record<string, unknown>;

  [key: string]: unknown;
}

/**
 * Audit logs table definition
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Note: No foreign key constraint on purpose - audit logs must be preserved
    // even after user deletion for compliance and auditing requirements
    userId: text('user_id').notNull(),
    userEmail: text('user_email'),
    userName: text('user_name'),

    // Action information
    action: text('action').notNull(), // e.g., user.create, role.update, plugin.install
    resource: text('resource').notNull(), // e.g., user, role, plugin
    resourceId: text('resource_id'),
    resourceName: text('resource_name'),

    // Request information
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    // Result status
    status: text('status').notNull(), // 'success' or 'failure'
    errorMessage: text('error_message'),
    errorStack: text('error_stack'),

    // Flexible metadata
    metadata: jsonb('metadata').$type<AuditLogMetadata>(),

    // Timestamp
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Indexes for query performance
    userIdx: index('audit_logs_user_idx').on(table.userId),
    actionIdx: index('audit_logs_action_idx').on(table.action),
    resourceIdx: index('audit_logs_resource_idx').on(table.resource, table.resourceId),
    createdAtIdx: index('audit_logs_created_at_idx').on(table.createdAt),
    userTimeIdx: index('audit_logs_user_time_idx').on(table.userId, table.createdAt),
    statusIdx: index('audit_logs_status_idx').on(table.status),
  })
);

// Type exports
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

import { eq, and, or, like, gte, lte, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import type { AuditLogMetadata } from '@/lib/db/schema/audit-logs';
import { sanitizeAuditDetails } from '@/lib/audit/audit-port.server';

/**
 * Audit Service
 *
 *
 * Handles creation and querying of audit logs for:
 * - user actions
 * - role assignments
 * - Plugin operations
 * - Entitlement operations
 * - System events
 */

/**
 * Predefined audit action constants
 */
export const AUDIT_ACTIONS = {
  // user actions
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  USER_PASSWORD_RESET: 'user.password_reset',
  USER_SUSPEND: 'user.suspend',
  USER_RESTORE: 'user.restore',

  // Role actions
  ROLE_CREATE: 'role.create',
  ROLE_UPDATE: 'role.update',
  ROLE_DELETE: 'role.delete',
  ROLE_ASSIGN: 'role.assign',
  ROLE_REVOKE: 'role.revoke',

  // Plugin actions
  PLUGIN_INSTALL: 'plugin.install',
  PLUGIN_UNINSTALL: 'plugin.uninstall',
  PLUGIN_ENABLE: 'plugin.enable',
  PLUGIN_DISABLE: 'plugin.disable',
  PLUGIN_CONFIGURE: 'plugin.configure',

  // Entitlement actions
  ENTITLEMENT_ASSIGN: 'entitlement.assign',
  ENTITLEMENT_UPDATE: 'entitlement.update',
  ENTITLEMENT_REVOKE: 'entitlement.revoke',
  ENTITLEMENT_EXPIRE: 'entitlement.expire',
  ENTITLEMENT_CREATED: 'entitlement.created',
  ENTITLEMENT_UPGRADED: 'entitlement.upgraded',
  ENTITLEMENT_CANCELLED_IMMEDIATELY: 'entitlement.cancelled_immediately',
  ENTITLEMENT_CANCEL_SCHEDULED: 'entitlement.cancel_scheduled',
  ENTITLEMENT_REACTIVATED: 'entitlement.reactivated',
  ENTITLEMENT_EXPIRED: 'entitlement.expired',

  // Plan actions
  PLAN_CREATE: 'plan.create',
  PLAN_UPDATE: 'plan.update',
  PLAN_DELETE: 'plan.delete',
  PLAN_SET_DEFAULT: 'plan.set_default',

  // Admin actions
  ADMIN_BULK_PLAN_ASSIGNMENT: 'admin.bulk_plan_assignment',
  ADMIN_BULK_LIMIT_ADJUSTMENT: 'admin.bulk_limit_adjustment',
  ADMIN_USAGE_RECALCULATION: 'admin.usage_recalculation',
  ADMIN_OVERRIDE_REMOVED: 'admin.override_removed',

  // Custom plan actions
  CUSTOM_PLAN_CREATED: 'custom_plan.created',
  CUSTOM_PLAN_UPDATED: 'custom_plan.updated',
  CUSTOM_PLAN_DELETED: 'custom_plan.deleted',

  // Add-on actions
  ADD_ON_PURCHASED: 'add_on.purchased',
  ADD_ON_CANCELLED: 'add_on.cancelled',
  ADD_ON_UPDATED: 'add_on.updated',
  BILLING_INVOICE_CREATE: 'billing.invoice.create',
  BILLING_PAYMENT_METHOD_CREATE: 'billing.payment_method.create',
  BILLING_TAX_PROFILE_UPSERT: 'billing.tax_profile.upsert',
  CREDIT_RECONCILIATION_RUN: 'credit.reconciliation.run',
  DATA_EXPORT: 'data.export',

  // File actions
  FILE_UPLOAD: 'file.upload',
  FILE_DELETE: 'file.delete',
  FILE_DOWNLOAD: 'file.download',
  FILE_UPLOADED: 'file.uploaded',
  FILE_DELETED: 'file.deleted',

  // Notification actions
  NOTIFICATION_SENT: 'notification.sent',
  NOTIFICATION_PREFERENCES_CREATED: 'notification.preferences_created',
  NOTIFICATION_PREFERENCES_UPDATED: 'notification.preferences_updated',

  // Subscription actions
  SUBSCRIPTION_TRIAL_STARTED: 'subscription.trial_started',
  SUBSCRIPTION_TRIAL_CONVERTED: 'subscription.trial_converted',
  SUBSCRIPTION_TRIAL_CANCELLED: 'subscription.trial_cancelled',
  SUBSCRIPTION_UPGRADE: 'subscription.upgrade',
  SUBSCRIPTION_DOWNGRADE: 'subscription.downgrade',
  SUBSCRIPTION_CHANGE: 'subscription.change',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  SUBSCRIPTION_REACTIVATED: 'subscription.reactivated',
  SUBSCRIPTION_RENEWED: 'subscription.renewed',

  // Setting actions
  SETTING_UPDATE: 'setting.update',

  // System actions
  SYSTEM_CONFIG_UPDATE: 'system.config.update',
  SYSTEM_BACKUP: 'system.backup',
  SYSTEM_RESTORE: 'system.restore',

  // Operations actions
  OUTBOX_DEAD_LETTER_REPLAY: 'outbox.dead_letter.replay',
  OUTBOX_DEAD_LETTER_IGNORE: 'outbox.dead_letter.ignore',
  OUTBOX_DEAD_LETTER_ARCHIVE: 'outbox.dead_letter.archive',
  OUTBOX_DEAD_LETTER_BULK: 'outbox.dead_letter.bulk',
  FILE_BULK_DELETE: 'file.bulk_delete',
  FILE_RETENTION_RUN: 'file.retention_run',
  AUDIT_RETENTION_RUN: 'audit.retention_run',
  AUDIT_EXPORT: 'audit.export',
  EDGE_ACCESS_LOG_INGEST: 'edge_access_log.ingest',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * Audit log entry parameters
 */
export interface AuditLogParams {
  userId: string;
  userEmail?: string;
  userName?: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  resourceName?: string;
  ipAddress?: string;
  userAgent?: string;
  status: 'success' | 'failure';
  errorMessage?: string;
  errorStack?: string;
  metadata?: AuditLogMetadata;
}

/**
 * Internal function to write audit log to database
 * Used by both sync and async versions
 */
async function writeAuditLog(params: AuditLogParams) {
  const metadata = sanitizeAuditDetails(params.metadata ?? {}) ?? {};

  return db
    .insert(auditLogs)
    .values({
      userId: params.userId,
      userEmail: params.userEmail,
      userName: params.userName,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      resourceName: params.resourceName,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      status: params.status,
      errorMessage: params.errorMessage,
      errorStack: params.errorStack,
      metadata,
      createdAt: new Date(),
    })
    .returning();
}

/**
 * Create an audit log entry (OPTIMIZED - async, non-blocking)
 *
 * This function does NOT wait for the database write to complete,
 * allowing the main request flow to continue without delay.
 *
 * Use Cases:
 * - Default for most operations (non-critical logging)
 * - High-throughput endpoints
 * - Real-time user-facing operations
 *
 * Note: If audit log write fails, it will be logged to console but won't affect the main operation
 */
export function auditLog(params: AuditLogParams): void {
  // Fire and forget - don't wait for completion
  writeAuditLog(params).catch((error) => {
    // Log to console but don't throw - audit logging should not break operations
    console.error('Failed to create audit log:', error, {
      action: params.action,
      resource: params.resource,
      userId: params.userId,
    });
  });
}

/**
 * Create an audit log entry synchronously (blocking)
 *
 * Use this when audit log must be written before continuing,
 * such as critical security events or compliance requirements.
 *
 * Use Cases:
 * - Critical security events (login attempts, permission changes)
 * - Compliance-required operations
 * - Transaction-critical logging (within db.transaction)
 *
 * Note: This will block the request until the audit log is written
 */
export async function auditLogSync(params: AuditLogParams) {
  try {
    const [log] = await writeAuditLog(params);
    return log;
  } catch (error) {
    // Log to console but don't throw - audit logging should not break operations
    console.error('Failed to create audit log:', error);
    return null;
  }
}

/**
 * Create a durable audit log entry.
 *
 * This is the preferred path for security, RBAC, billing, plugin lifecycle,
 * license, and destructive data operations where the caller should know if
 * the audit write failed.
 */
export async function auditLogDurable(params: AuditLogParams) {
  const [log] = await writeAuditLog(params);
  return log;
}

/**
 * Query audit logs with filters
 */
export interface AuditLogFilters {
  userId?: string;
  action?: AuditAction | string;
  resource?: string;
  status?: 'success' | 'failure';
  search?: string; // Search in resource name, user name, or user email
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export async function queryAuditLogs(filters: AuditLogFilters = {}) {
  const {
    userId,
    action,
    resource,
    status,
    search,
    startDate,
    endDate,
    page = 1,
    limit = 50,
  } = filters;

  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions = [];

  if (userId) {
    conditions.push(eq(auditLogs.userId, userId));
  }

  if (action) {
    conditions.push(eq(auditLogs.action, action));
  }

  if (resource) {
    conditions.push(eq(auditLogs.resource, resource));
  }

  if (status) {
    conditions.push(eq(auditLogs.status, status));
  }

  if (search) {
    conditions.push(
      or(
        like(auditLogs.resourceName, `%${search}%`),
        like(auditLogs.userName, `%${search}%`),
        like(auditLogs.userEmail, `%${search}%`),
        like(auditLogs.action, `%${search}%`)
      )
    );
  }

  if (startDate) {
    conditions.push(gte(auditLogs.createdAt, startDate));
  }

  if (endDate) {
    conditions.push(lte(auditLogs.createdAt, endDate));
  }

  // Build where clause
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get logs with pagination
  const logs = await db
    .select()
    .from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogs)
    .where(whereClause);
  const total = Number(countResult[0]?.count || 0);

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get recent audit logs for a user
 */
export async function getUserRecentActivity(userId: string, limit = 10) {
  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.userId, userId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  return logs;
}

/**
 * Get audit logs for a specific resource
 */
export async function getResourceAuditLogs(resource: string, resourceId: string, limit = 20) {
  const logs = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.resource, resource), eq(auditLogs.resourceId, resourceId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  return logs;
}

/**
 * Get a single audit log by ID
 */
export async function getAuditLogById(id: string) {
  const [log] = await db.select().from(auditLogs).where(eq(auditLogs.id, id)).limit(1);

  return log || null;
}

/**
 * Get audit log statistics
 */
export async function getAuditLogStats(filters: { startDate?: Date; endDate?: Date } = {}) {
  const conditions = [];

  if (filters.startDate) {
    conditions.push(gte(auditLogs.createdAt, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(auditLogs.createdAt, filters.endDate));
  }

  // Build where clause
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Total logs
  const [{ count: total }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogs)
    .where(whereClause);

  // Success vs failure
  const [{ count: success }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogs)
    .where(
      whereClause
        ? and(whereClause, eq(auditLogs.status, 'success'))
        : eq(auditLogs.status, 'success')
    );

  // By action type
  const byAction = await db
    .select({
      action: auditLogs.action,
      count: sql<number>`count(*)`,
    })
    .from(auditLogs)
    .where(whereClause)
    .groupBy(auditLogs.action)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  // By resource type
  const byResource = await db
    .select({
      resource: auditLogs.resource,
      count: sql<number>`count(*)`,
    })
    .from(auditLogs)
    .where(whereClause)
    .groupBy(auditLogs.resource)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  return {
    total: Number(total),
    success: Number(success),
    failure: Number(total) - Number(success),
    byAction: byAction.map((item) => ({
      action: item.action,
      count: Number(item.count),
    })),
    byResource: byResource.map((item) => ({
      resource: item.resource,
      count: Number(item.count),
    })),
  };
}

export async function applyAuditLogRetention(retentionDays: number): Promise<{
  retentionDays: number;
  cutoff: Date;
  deleted: number;
}> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await db.delete(auditLogs).where(lte(auditLogs.createdAt, cutoff));
  const deleted =
    typeof result === 'object' && result && 'count' in result
      ? Number((result as { count: unknown }).count)
      : 0;

  return {
    retentionDays,
    cutoff,
    deleted,
  };
}

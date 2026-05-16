/**
 * Audit Port
 *
 * Interface for audit logging with outbox support.
 * Critical audit events (security, billing, admin, plugin lifecycle)
 * must be durable and not fire-and-forget.
 *
 * Phase 1: In-memory with fallback to structured logging
 * Phase 2: Database-backed with outbox
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';

import { logger } from '@/lib/_core/logger';
import { db as defaultDb, type Database } from '@/lib/db/client.server';
import { auditLogs, type AuditLogMetadata } from '@/lib/db/schema/audit-logs';

export type AuditEventType =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.failed'
  | 'admin.action'
  | 'plan.changed'
  | 'price.changed'
  | 'webhook.received'
  | 'webhook.processed'
  | 'webhook.failed'
  | 'plugin.installed'
  | 'plugin.enabled'
  | 'plugin.disabled'
  | 'plugin.uninstalled'
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'file.uploaded'
  | 'file.downloaded'
  | 'file.expired'
  | 'file.deleted';

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  actorId?: string;
  actorType?: 'user' | 'system' | 'plugin';
  targetId?: string;
  targetType?: string;
  action: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

export interface AuditPortCapabilities {
  storage: 'memory' | 'database';
  durable: boolean;
  redactsSensitiveDetails: boolean;
}

export interface AuditPort {
  log(event: AuditEvent): Promise<void>;
  query(options: {
    type?: AuditEventType;
    actorId?: string;
    targetId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditEvent[]>;
  getCapabilities?(): AuditPortCapabilities;
}

const auditEventTypes = new Set<string>([
  'auth.login',
  'auth.logout',
  'auth.failed',
  'admin.action',
  'plan.changed',
  'price.changed',
  'webhook.received',
  'webhook.processed',
  'webhook.failed',
  'plugin.installed',
  'plugin.enabled',
  'plugin.disabled',
  'plugin.uninstalled',
  'user.created',
  'user.updated',
  'user.deleted',
  'file.uploaded',
  'file.downloaded',
  'file.expired',
  'file.deleted',
]);

function isAuditEventType(value: unknown): value is AuditEventType {
  return typeof value === 'string' && auditEventTypes.has(value);
}

const SENSITIVE_AUDIT_KEY_PATTERNS = [
  'authorization',
  'cookie',
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'paymentmethod',
  'payment_method',
  'signature',
  'stripe-signature',
  'webhooksignature',
  'webhook_signature',
];

function isSensitiveAuditKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replace(/[\s.-]/g, '_');
  return SENSITIVE_AUDIT_KEY_PATTERNS.some((pattern) => normalizedKey.includes(pattern));
}

function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item));
  }

  if (value instanceof Date) {
    return value;
  }

  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      sanitized[key] = isSensitiveAuditKey(key) ? '[REDACTED]' : sanitizeAuditValue(nestedValue);
    }
    return sanitized;
  }

  return value;
}

export function sanitizeAuditDetails(
  details?: Record<string, unknown> | null
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  return sanitizeAuditValue(details) as Record<string, unknown>;
}

/**
 * In-memory audit port (Phase 1)
 * Logs to structured logger and keeps recent events in memory
 */
export class MemoryAuditPort implements AuditPort {
  private events: AuditEvent[] = [];
  private maxSize: number;

  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
  }

  async log(event: AuditEvent): Promise<void> {
    // Sanitize details to remove PII
    const sanitizedDetails = sanitizeAuditDetails(event.details);

    // Write to structured logger
    logger.info(
      {
        auditId: event.id,
        auditType: event.type,
        actorId: event.actorId,
        actorType: event.actorType,
        action: event.action,
        targetId: event.targetId,
        details: sanitizedDetails,
      },
      `Audit: ${event.action}`
    );

    // Store sanitized event in memory so queries do not expose secrets.
    this.events.unshift({
      ...event,
      details: sanitizedDetails,
    });
    if (this.events.length > this.maxSize) {
      this.events = this.events.slice(0, this.maxSize);
    }
  }

  async query(options: {
    type?: AuditEventType;
    actorId?: string;
    targetId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditEvent[]> {
    let results = this.events;

    if (options.type) {
      results = results.filter((e) => e.type === options.type);
    }
    if (options.actorId) {
      results = results.filter((e) => e.actorId === options.actorId);
    }
    if (options.targetId) {
      results = results.filter((e) => e.targetId === options.targetId);
    }
    if (options.from) {
      results = results.filter((e) => e.timestamp >= options.from!);
    }
    if (options.to) {
      results = results.filter((e) => e.timestamp <= options.to!);
    }

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;

    return results.slice(offset, offset + limit);
  }

  getCapabilities(): AuditPortCapabilities {
    return {
      storage: 'memory',
      durable: false,
      redactsSensitiveDetails: true,
    };
  }
}

export class DatabaseAuditPort implements AuditPort {
  constructor(private readonly database: Database = defaultDb) {}

  async log(event: AuditEvent): Promise<void> {
    const details = sanitizeAuditDetails(event.details);
    const resource = event.targetType ?? event.type.split('.')[0] ?? 'system';
    const metadata: AuditLogMetadata = {
      auditEventId: event.id,
      auditType: event.type,
      actorType: event.actorType,
      targetType: event.targetType,
      details,
      timestamp: event.timestamp.toISOString(),
    };

    await this.database.insert(auditLogs).values({
      userId: event.actorId ?? 'system',
      action: event.action,
      resource,
      resourceId: event.targetId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      status: 'success',
      metadata,
      createdAt: event.timestamp,
    });

    logger.info(
      {
        auditId: event.id,
        auditType: event.type,
        actorId: event.actorId,
        actorType: event.actorType,
        action: event.action,
        targetId: event.targetId,
        storage: 'database',
      },
      `Audit: ${event.action}`
    );
  }

  async query(options: {
    type?: AuditEventType;
    actorId?: string;
    targetId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditEvent[]> {
    const conditions: SQL[] = [];

    if (options.type) {
      conditions.push(sql`${auditLogs.metadata}->>'auditType' = ${options.type}`);
    }
    if (options.actorId) {
      conditions.push(eq(auditLogs.userId, options.actorId));
    }
    if (options.targetId) {
      conditions.push(eq(auditLogs.resourceId, options.targetId));
    }
    if (options.from) {
      conditions.push(gte(auditLogs.createdAt, options.from));
    }
    if (options.to) {
      conditions.push(lte(auditLogs.createdAt, options.to));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const rows = where
      ? await this.database
          .select()
          .from(auditLogs)
          .where(where)
          .orderBy(desc(auditLogs.createdAt))
          .limit(limit)
          .offset(offset)
      : await this.database
          .select()
          .from(auditLogs)
          .orderBy(desc(auditLogs.createdAt))
          .limit(limit)
          .offset(offset);

    return rows.map((row) => {
      const metadata = row.metadata ?? {};
      const auditType = isAuditEventType(metadata.auditType) ? metadata.auditType : 'admin.action';
      const details =
        metadata.details && typeof metadata.details === 'object'
          ? (metadata.details as Record<string, unknown>)
          : undefined;

      return {
        id: typeof metadata.auditEventId === 'string' ? metadata.auditEventId : row.id,
        type: auditType,
        actorId: row.userId,
        actorType:
          metadata.actorType === 'user' ||
          metadata.actorType === 'system' ||
          metadata.actorType === 'plugin'
            ? metadata.actorType
            : undefined,
        targetId: row.resourceId ?? undefined,
        targetType: typeof metadata.targetType === 'string' ? metadata.targetType : row.resource,
        action: row.action,
        details,
        ipAddress: row.ipAddress ?? undefined,
        userAgent: row.userAgent ?? undefined,
        timestamp: row.createdAt,
      };
    });
  }

  getCapabilities(): AuditPortCapabilities {
    return {
      storage: 'database',
      durable: true,
      redactsSensitiveDetails: true,
    };
  }
}

/**
 * Global audit port instance
 */
let globalAuditPort: AuditPort = new MemoryAuditPort();

export function setAuditPort(port: AuditPort): void {
  globalAuditPort = port;
}

export function getAuditPort(): AuditPort {
  return globalAuditPort;
}

export function describeAuditPort(port: AuditPort = globalAuditPort): AuditPortCapabilities {
  return (
    port.getCapabilities?.() ?? {
      storage: 'memory',
      durable: false,
      redactsSensitiveDetails: false,
    }
  );
}

/**
 * Convenience function for logging audit events
 */
export async function auditLog(
  type: AuditEventType,
  action: string,
  options: {
    actorId?: string;
    actorType?: 'user' | 'system' | 'plugin';
    targetId?: string;
    targetType?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  } = {}
): Promise<void> {
  const event: AuditEvent = {
    id: randomUUID(),
    type,
    action,
    timestamp: new Date(),
    ...options,
  };

  await globalAuditPort.log(event);
}

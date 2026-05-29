import { createHash } from 'node:crypto';
import { redactAuditMetadata } from './redaction';

export type RuntimeAuditRisk = 'low' | 'medium' | 'high';

export interface RuntimeAuditIntegrity {
  schemaVersion: 1;
  category: string;
  risk: RuntimeAuditRisk;
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
  previousHash?: string | null;
  recordHash: string;
}

export interface RuntimeAuditEnvelopeInput {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  actorId?: string | null;
  type: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  previousHash?: string | null;
}

const RESOURCE_KEYS = [
  'fileId',
  'outboxId',
  'receiptId',
  'runId',
  'userId',
  'entitlementId',
  'grantId',
  'orderId',
  'invoiceId',
  'subscriptionId',
  'settingId',
  'connectionId',
  'moduleId',
  'workspaceId',
] as const;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (!value || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function categoryForType(type: string): string {
  if (type.startsWith('admin.')) {
    return 'admin';
  }
  if (type.startsWith('host.identity.')) {
    return 'identity';
  }
  if (type.startsWith('commercial.') || type.includes('billing') || type.includes('payment')) {
    return 'commercial';
  }
  if (type.startsWith('host.edge.')) {
    return 'edge-access';
  }
  if (type.includes('webhook') || type.includes('outbox')) {
    return 'delivery';
  }
  if (type.includes('file')) {
    return 'files';
  }
  if (type.includes('module')) {
    return 'module';
  }
  return 'operation';
}

function riskForType(type: string, metadata: Record<string, unknown>): RuntimeAuditRisk {
  const haystack = `${type} ${stableJson(metadata)}`.toLowerCase();
  if (
    ['delete', 'discard', 'revoke', 'disable', 'retention', 'override', 'role', 'password', 'session.revoked'].some(
      (token) => haystack.includes(token)
    )
  ) {
    return 'high';
  }
  if (['failed', 'denied', 'blocked', 'error', 'rejected'].some((token) => haystack.includes(token))) {
    return 'medium';
  }
  return 'low';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resourceFromMetadata(metadata: Record<string, unknown>): {
  resourceType?: string;
  resourceId?: string;
} {
  for (const key of RESOURCE_KEYS) {
    const value = stringValue(metadata[key]);
    if (value) {
      return {
        resourceType: key.replace(/Id$/, ''),
        resourceId: value,
      };
    }
  }
  return {};
}

function correlationFromMetadata(metadata: Record<string, unknown>): string | undefined {
  return (
    stringValue(metadata.correlationId) ??
    stringValue(metadata.requestId) ??
    stringValue(metadata.idempotencyKey) ??
    stringValue(metadata.runId) ??
    stringValue(metadata.outboxId)
  );
}

export function createAuditEnvelope(input: RuntimeAuditEnvelopeInput): {
  metadata: Record<string, unknown>;
  integrity: RuntimeAuditIntegrity;
  storedMetadata: Record<string, unknown>;
} {
  const metadata = redactAuditMetadata(input.metadata ?? {});
  const resource = resourceFromMetadata(metadata);
  const integrityBase = {
    id: input.id,
    productId: input.productId,
    workspaceId: input.workspaceId ?? null,
    moduleId: input.moduleId ?? null,
    actorId: input.actorId ?? null,
    type: input.type,
    metadata,
    createdAt: input.createdAt,
    previousHash: input.previousHash ?? null,
  };
  const integrity: RuntimeAuditIntegrity = {
    schemaVersion: 1,
    category: categoryForType(input.type),
    risk: riskForType(input.type, metadata),
    ...resource,
    correlationId: correlationFromMetadata(metadata),
    previousHash: input.previousHash ?? null,
    recordHash: sha256(integrityBase),
  };
  return {
    metadata,
    integrity,
    storedMetadata: {
      ...metadata,
      _audit: integrity,
    },
  };
}

export function splitAuditEnvelope(metadata: Record<string, unknown> | undefined): {
  metadata: Record<string, unknown>;
  integrity?: RuntimeAuditIntegrity;
} {
  const raw = metadata ?? {};
  const envelope = raw._audit;
  const { _audit: _ignored, ...rest } = raw;
  if (!envelope || typeof envelope !== 'object') {
    return { metadata: rest };
  }
  const record = envelope as Record<string, unknown>;
  const recordHash = stringValue(record.recordHash);
  if (!recordHash) {
    return { metadata: rest };
  }
  return {
    metadata: rest,
    integrity: {
      schemaVersion: 1,
      category: stringValue(record.category) ?? 'operation',
      risk:
        record.risk === 'high' || record.risk === 'medium' || record.risk === 'low'
          ? record.risk
          : 'low',
      resourceType: stringValue(record.resourceType),
      resourceId: stringValue(record.resourceId),
      correlationId: stringValue(record.correlationId),
      previousHash: stringValue(record.previousHash) ?? null,
      recordHash,
    },
  };
}

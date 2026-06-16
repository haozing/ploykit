import type { RuntimeStoreScope } from './runtime-store-common-types';

export interface RuntimeStoreAuditRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  actorId?: string | null;
  type: string;
  metadata: Record<string, unknown>;
  integrity?: {
    schemaVersion: 1;
    category: string;
    risk: 'low' | 'medium' | 'high';
    resourceType?: string;
    resourceId?: string;
    correlationId?: string;
    previousHash?: string | null;
    recordHash: string;
  };
  createdAt: string;
}

export interface RuntimeStoreUsageRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  meter: string;
  quantity: number;
  unit?: string;
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type RuntimeStoreProviderInvocationStatus = 'succeeded' | 'failed';

export interface RuntimeStoreProviderInvocationRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  providerId: string;
  kind: string;
  operation: string;
  status: RuntimeStoreProviderInvocationStatus;
  target?: string | null;
  model?: string | null;
  serviceConnectionId?: string | null;
  resourceBindingId?: string | null;
  usage: Record<string, unknown>;
  cost: Record<string, unknown>;
  latencyMs: number;
  correlationId?: string | null;
  error?: { code: string; message: string };
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RecordRuntimeStoreProviderInvocationInput extends RuntimeStoreScope {
  providerId: string;
  kind: string;
  operation: string;
  status: RuntimeStoreProviderInvocationStatus;
  target?: string | null;
  model?: string | null;
  serviceConnectionId?: string | null;
  resourceBindingId?: string | null;
  usage?: Record<string, unknown>;
  cost?: Record<string, unknown>;
  latencyMs?: number;
  correlationId?: string | null;
  error?: Error | string | { code: string; message: string };
  metadata?: Record<string, unknown>;
}

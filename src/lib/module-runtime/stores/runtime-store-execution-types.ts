import type { ModuleRunKind, ModuleRunStatus } from '../runs';
import type { RuntimeStoreScope } from './runtime-store-common-types';

export interface CreateRuntimeStoreRunInput<TInput = unknown> extends RuntimeStoreScope {
  id?: string;
  moduleId: string;
  kind: ModuleRunKind;
  name: string;
  input?: TInput;
  maxAttempts?: number;
  costRef?: string;
  idempotencyKey?: string;
}

export interface ListRuntimeStoreRunsQuery {
  productId?: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  moduleId?: string;
  status?: ModuleRunStatus;
  kind?: ModuleRunKind;
  idempotencyKey?: string;
}

export type RuntimeStoreOutboxStatus =
  | 'queued'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'dead_letter'
  | 'archived';

export interface RuntimeStoreOutboxRecord<TPayload = unknown> {
  id: string;
  productId: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  moduleId?: string | null;
  name: string;
  payload: TPayload;
  metadata: Record<string, unknown>;
  status: RuntimeStoreOutboxStatus;
  attempts: number;
  idempotencyKey?: string;
  scheduledAt?: string;
  priority?: number;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  heartbeatAt?: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
  error?: { code: string; message: string };
}

export type RuntimeStoreDeliveryKind = 'job' | 'event' | 'webhook' | 'email' | 'worker';

export type RuntimeStoreDeliveryStatus =
  | 'queued'
  | 'processing'
  | 'delivered'
  | 'failed'
  | 'dead_letter'
  | 'skipped'
  | 'archived';

export interface RuntimeStoreDeliveryRecord {
  id: string;
  productId: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  moduleId?: string | null;
  actorId?: string | null;
  kind: RuntimeStoreDeliveryKind;
  source: string;
  target: string;
  status: RuntimeStoreDeliveryStatus;
  attempts: number;
  outboxId?: string | null;
  runId?: string | null;
  receiptId?: string | null;
  eventId?: string | null;
  emailId?: string | null;
  workerId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  nextRetryAt?: string | null;
  errorCategory?: string | null;
  error?: { code: string; message: string };
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RecordRuntimeStoreDeliveryInput extends RuntimeStoreScope {
  kind: RuntimeStoreDeliveryKind;
  source: string;
  target: string;
  status: RuntimeStoreDeliveryStatus;
  attempts?: number;
  outboxId?: string | null;
  runId?: string | null;
  receiptId?: string | null;
  eventId?: string | null;
  emailId?: string | null;
  workerId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  nextRetryAt?: string | null;
  errorCategory?: string | null;
  error?: Error | string | { code: string; message: string };
  metadata?: Record<string, unknown>;
}

export type RuntimeStoreWorkerStatus =
  | 'starting'
  | 'running'
  | 'idle'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface RuntimeStoreWorkerRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  workerId: string;
  profile: string;
  status: RuntimeStoreWorkerStatus;
  queueProfile: string;
  heartbeatAt: string;
  lastDrainAt?: string | null;
  lastDurationMs: number;
  processed: number;
  failed: number;
  deadLettered: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreWorkerInput extends RuntimeStoreScope {
  workerId: string;
  profile?: string;
  status?: RuntimeStoreWorkerStatus;
  queueProfile?: string;
  heartbeatAt?: string;
  lastDrainAt?: string | null;
  lastDurationMs?: number;
  processed?: number;
  failed?: number;
  deadLettered?: number;
  metadata?: Record<string, unknown>;
}

export interface EnqueueRuntimeStoreOutboxInput<TPayload = unknown> extends RuntimeStoreScope {
  name: string;
  payload: TPayload;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  scheduledAt?: string;
  priority?: number;
}

export type RuntimeStoreWebhookReceiptStatus =
  | 'received'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'duplicate'
  | 'rejected';

export interface RuntimeStoreWebhookReceipt {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  webhookName: string;
  path: string;
  method: string;
  status: RuntimeStoreWebhookReceiptStatus;
  attempts: number;
  idempotencyKey?: string;
  signature?: string;
  headers?: Record<string, string>;
  bodyText?: string;
  bodyDigest?: string;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
  error?: { code: string; message: string };
}

export interface CreateRuntimeStoreWebhookReceiptInput extends RuntimeStoreScope {
  moduleId: string;
  webhookName: string;
  path: string;
  method: string;
  idempotencyKey?: string;
  signature?: string;
  headers?: Record<string, string>;
  bodyText?: string;
  bodyDigest?: string;
}

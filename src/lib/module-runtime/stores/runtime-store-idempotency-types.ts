import type { RuntimeStoreScope } from './runtime-store-common-types';

export type RuntimeStoreIdempotencyStatus = 'in_progress' | 'completed';

export type RuntimeStoreIdempotencyBeginOutcome =
  | 'started'
  | 'replay'
  | 'conflict'
  | 'in_progress';

export interface RuntimeStoreIdempotencyRecord {
  id: string;
  productId: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  namespace: string;
  key: string;
  requestHash: string;
  status: RuntimeStoreIdempotencyStatus;
  lockedAt: string;
  expiresAt: string;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBodyBase64?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BeginRuntimeStoreIdempotencyKeyInput extends RuntimeStoreScope {
  namespace: string;
  key: string;
  requestHash: string;
  recoverLockedBefore?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeStoreIdempotencyBeginResult {
  outcome: RuntimeStoreIdempotencyBeginOutcome;
  record: RuntimeStoreIdempotencyRecord;
}

export interface CompleteRuntimeStoreIdempotencyKeyInput {
  id: string;
  responseStatus: number;
  responseHeaders?: Record<string, string>;
  responseBodyBase64?: string;
  metadata?: Record<string, unknown>;
}

export interface ListRuntimeStoreIdempotencyKeysQuery {
  productId?: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  namespace?: string;
  status?: RuntimeStoreIdempotencyStatus;
  expiresBefore?: string;
}

export interface DeleteExpiredRuntimeStoreIdempotencyKeysQuery {
  productId?: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  before?: string;
  limit?: number;
}

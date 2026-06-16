import type { RuntimeStoreScope } from './runtime-store-common-types';

export type RuntimeStoreRagSourceStatus = 'indexed' | 'deleted' | 'stale';

export interface RuntimeStoreRagSourceRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  sourceId: string;
  status: RuntimeStoreRagSourceStatus;
  contentDigest?: string | null;
  contentLength: number;
  chunkCount: number;
  indexedAt?: string | null;
  deletedAt?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreRagSourceInput extends RuntimeStoreScope {
  moduleId: string;
  sourceId: string;
  status?: RuntimeStoreRagSourceStatus;
  contentDigest?: string | null;
  contentLength?: number;
  chunkCount?: number;
  indexedAt?: string | null;
  deletedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RuntimeStoreRagChunkRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreRagChunkInput extends RuntimeStoreScope {
  id?: string;
  moduleId: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

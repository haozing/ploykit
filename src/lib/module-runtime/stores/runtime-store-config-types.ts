import type { RuntimeStoreScope } from './runtime-store-common-types';

export type RuntimeStoreSettingStatus = 'active' | 'draft' | 'archived';

export interface RuntimeStoreSettingRecord<TValue = unknown> {
  id: string;
  productId: string;
  workspaceId?: string | null;
  namespace: string;
  key: string;
  value: TValue;
  status: RuntimeStoreSettingStatus;
  version: number;
  updatedBy?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreSettingInput<TValue = unknown> extends RuntimeStoreScope {
  namespace: string;
  key: string;
  value: TValue;
  status?: RuntimeStoreSettingStatus;
  version?: number;
  metadata?: Record<string, unknown>;
}

export type RuntimeStoreServiceConnectionStatus = 'active' | 'disabled' | 'blocked';

export interface RuntimeStoreServiceConnectionRecord {
  connectionId: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  service: string;
  provider: string;
  status: RuntimeStoreServiceConnectionStatus;
  environment?: string;
  ownerType?: string;
  scopeType?: string;
  authType?: string;
  config: Record<string, unknown>;
  secretRefs: Record<string, string>;
  health: Record<string, unknown>;
  lastUsedAt?: string;
  updatedBy?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreServiceConnectionInput extends RuntimeStoreScope {
  connectionId: string;
  moduleId?: string | null;
  service: string;
  provider: string;
  status?: RuntimeStoreServiceConnectionStatus;
  environment?: string;
  ownerType?: string;
  scopeType?: string;
  authType?: string;
  config?: Record<string, unknown>;
  secretRefs?: Record<string, string>;
  health?: Record<string, unknown>;
  lastUsedAt?: string;
  metadata?: Record<string, unknown>;
}

export type RuntimeStoreResourceBindingStatus = 'active' | 'disabled';

export interface RuntimeStoreResourceBindingRecord<TValue = unknown> {
  bindingId: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  name: string;
  kind?: string;
  value: TValue;
  status: RuntimeStoreResourceBindingStatus;
  updatedBy?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreResourceBindingInput<
  TValue = unknown,
> extends RuntimeStoreScope {
  bindingId?: string;
  name: string;
  kind?: string;
  value: TValue;
  status?: RuntimeStoreResourceBindingStatus;
  metadata?: Record<string, unknown>;
}

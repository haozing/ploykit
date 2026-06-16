import type {
  ModuleNotificationChannel,
  ModuleNotificationRecord,
  ModuleNotificationStatus,
} from '@ploykit/module-sdk';
import type { RuntimeStoreScope } from './runtime-store-common-types';

export type RuntimeStoreNotificationCategory =
  | 'tasks'
  | 'billing'
  | 'files'
  | 'workspace'
  | 'admin'
  | 'system';

export type RuntimeStoreNotificationDeliveryStatus = 'delivered' | 'skipped' | 'failed';

export interface RuntimeStoreNotificationRecord extends ModuleNotificationRecord {
  productId: string;
  workspaceId?: string | null;
  source: string;
  category: RuntimeStoreNotificationCategory;
  deliveryStatus: RuntimeStoreNotificationDeliveryStatus;
  idempotencyKey?: string;
  deliveredAt?: string;
  skippedAt?: string;
  error?: { code: string; message: string };
}

export interface CreateRuntimeStoreNotificationInput extends RuntimeStoreScope {
  moduleId?: string | null;
  userId: string;
  channel?: ModuleNotificationChannel;
  title: string;
  body?: string;
  actionUrl?: string;
  runId?: string;
  source?: string;
  category?: RuntimeStoreNotificationCategory;
  status?: ModuleNotificationStatus;
  deliveryStatus?: RuntimeStoreNotificationDeliveryStatus;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  error?: Error | string;
}

export interface RuntimeStoreNotificationDeliveryRecord {
  id: string;
  notificationId?: string | null;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  channel: ModuleNotificationChannel;
  provider: string;
  status: RuntimeStoreNotificationDeliveryStatus;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

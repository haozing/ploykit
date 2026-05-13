import { nanoid } from 'nanoid';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { logger } from '@/lib/_core/logger';
import { requireUserContext, withSystemContext } from '@/lib/db';
import {
  notifications,
  userProfiles,
  type NewNotificationRecord,
  type NotificationChannel,
  type NotificationRecord,
  type NotificationStatus,
} from '@/lib/db/schema';
import { getSystemSettings } from '@/lib/services/system-settings/system-settings-service';
import { NotFoundError } from '@/lib/_core/errors';

export interface NotificationPreferences {
  emailEnabled: boolean;
  emailAddress?: string;
  webhookEnabled: boolean;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  inAppEnabled: boolean;
}

export interface CreateNotificationInput {
  userId: string;
  type: string;
  channel?: 'in-app' | 'in_app' | 'email' | 'webhook';
  subject?: string;
  body: string;
  recipient?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationListOptions {
  userId: string;
  limit?: number;
  offset?: number;
}

export interface NotificationListResult {
  notifications: NotificationDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface NotificationDTO {
  id: string;
  type: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string | null;
  body: string;
  status: NotificationStatus;
  error: string | null;
  readAt: string | null;
  sentAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 100;

export async function getDefaultNotificationPreferences(): Promise<NotificationPreferences> {
  const settings = await getSystemSettings();

  return {
    emailEnabled: settings.notifications.emailEnabled,
    webhookEnabled: settings.notifications.webhookEnabled,
    webhookUrl: null,
    webhookSecret: null,
    inAppEnabled: settings.notifications.inAppEnabled,
  };
}

export async function createNotification(
  input: CreateNotificationInput
): Promise<NotificationDTO | null> {
  const channel = normalizeChannel(input.channel);
  const preferences = await getNotificationPreferences(input.userId);

  if (!isChannelEnabled(preferences, channel)) {
    logger.info(
      { userId: input.userId, channel, type: input.type },
      'Notification skipped by user preferences'
    );
    return null;
  }

  const now = new Date();
  const recipient = resolveRecipient(input.userId, channel, input.recipient, preferences);
  const status: NotificationStatus = channel === 'in_app' ? 'sent' : 'pending';
  const sentAt = channel === 'in_app' ? now : null;

  const [record] = await withSystemContext(async (database) => {
    return await database
      .insert(notifications)
      .values({
        id: `notification_${nanoid()}`,
        userId: input.userId,
        type: input.type,
        channel,
        recipient,
        subject: input.subject?.trim() || null,
        body: input.body.trim(),
        status,
        sentAt,
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      } satisfies NewNotificationRecord)
      .returning();
  });

  return toNotificationDTO(record);
}

export async function listUnreadNotifications(
  options: NotificationListOptions
): Promise<NotificationDTO[]> {
  const limit = normalizeLimit(options.limit, 20);
  const offset = normalizeOffset(options.offset);

  const rows = await requireUserContext(options.userId, async (database) => {
    return await database.query.notifications.findMany({
      where: and(
        eq(notifications.userId, options.userId),
        eq(notifications.channel, 'in_app'),
        eq(notifications.status, 'sent'),
        isNull(notifications.readAt)
      ),
      orderBy: [desc(notifications.createdAt)],
      limit,
      offset,
    });
  });

  return rows.map(toNotificationDTO);
}

export async function listNotificationHistory(
  options: NotificationListOptions
): Promise<NotificationListResult> {
  const limit = normalizeLimit(options.limit, DEFAULT_HISTORY_LIMIT);
  const offset = normalizeOffset(options.offset);
  const page = Math.floor(offset / limit) + 1;

  const rows = await requireUserContext(options.userId, async (database) => {
    return await database.query.notifications.findMany({
      where: eq(notifications.userId, options.userId),
      orderBy: [desc(notifications.createdAt)],
      limit,
      offset,
    });
  });

  const [{ count = 0 } = { count: 0 }] = await requireUserContext(
    options.userId,
    async (database) => {
      return await database
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(eq(notifications.userId, options.userId));
    }
  );

  const total = Number(count || 0);

  return {
    notifications: rows.map(toNotificationDTO),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function markNotificationRead(
  userId: string,
  notificationId: string
): Promise<NotificationDTO> {
  const now = new Date();
  const [record] = await requireUserContext(userId, async (database) => {
    return await database
      .update(notifications)
      .set({
        readAt: now,
        updatedAt: now,
      })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
      .returning();
  });

  if (!record) {
    throw new NotFoundError('Notification', notificationId);
  }

  return toNotificationDTO(record);
}

export async function markAllNotificationsRead(userId: string): Promise<{ updated: number }> {
  const now = new Date();
  const rows = await requireUserContext(userId, async (database) => {
    return await database
      .update(notifications)
      .set({
        readAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.channel, 'in_app'),
          eq(notifications.status, 'sent'),
          isNull(notifications.readAt)
        )
      )
      .returning();
  });

  return { updated: rows.length };
}

export async function deleteNotification(
  userId: string,
  notificationId: string
): Promise<{ deleted: true }> {
  const rows = await requireUserContext(userId, async (database) => {
    return await database
      .delete(notifications)
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
      .returning();
  });

  if (rows.length === 0) {
    throw new NotFoundError('Notification', notificationId);
  }

  return { deleted: true };
}

export async function sendTestNotification(userId: string): Promise<NotificationDTO | null> {
  return await createNotification({
    userId,
    type: 'notification.test',
    channel: 'in-app',
    subject: 'Test notification',
    body: 'Your notification settings are working.',
    metadata: {
      source: 'notifications.test',
    },
  });
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const profile = await requireUserContext(userId, async (database) => {
    return await database.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
    });
  });

  const preferences = (profile?.preferences || {}) as Record<string, unknown>;
  const nested =
    preferences.notificationSettings &&
    typeof preferences.notificationSettings === 'object' &&
    !Array.isArray(preferences.notificationSettings)
      ? (preferences.notificationSettings as Record<string, unknown>)
      : {};

  const defaults = await getDefaultNotificationPreferences();

  return {
    emailEnabled:
      typeof nested.emailEnabled === 'boolean' ? nested.emailEnabled : defaults.emailEnabled,
    emailAddress: typeof nested.emailAddress === 'string' ? nested.emailAddress : undefined,
    webhookEnabled:
      typeof nested.webhookEnabled === 'boolean' ? nested.webhookEnabled : defaults.webhookEnabled,
    webhookUrl: typeof nested.webhookUrl === 'string' ? nested.webhookUrl : null,
    webhookSecret: typeof nested.webhookSecret === 'string' ? nested.webhookSecret : null,
    inAppEnabled:
      typeof nested.inAppEnabled === 'boolean' ? nested.inAppEnabled : defaults.inAppEnabled,
  };
}

function isChannelEnabled(
  preferences: NotificationPreferences,
  channel: NotificationChannel
): boolean {
  if (channel === 'in_app') {
    return preferences.inAppEnabled;
  }

  if (channel === 'email') {
    return preferences.emailEnabled;
  }

  return preferences.webhookEnabled && Boolean(preferences.webhookUrl);
}

function resolveRecipient(
  userId: string,
  channel: NotificationChannel,
  requestedRecipient: string | undefined,
  preferences: NotificationPreferences
): string {
  if (requestedRecipient?.trim()) {
    return requestedRecipient.trim();
  }

  if (channel === 'email' && preferences.emailAddress?.trim()) {
    return preferences.emailAddress.trim();
  }

  if (channel === 'webhook' && preferences.webhookUrl?.trim()) {
    return preferences.webhookUrl.trim();
  }

  return userId;
}

function normalizeChannel(channel: CreateNotificationInput['channel']): NotificationChannel {
  if (channel === 'email' || channel === 'webhook') {
    return channel;
  }

  return 'in_app';
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  const value = Number(limit ?? fallback);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(value), MAX_HISTORY_LIMIT));
}

function normalizeOffset(offset: number | undefined): number {
  const value = Number(offset ?? 0);
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

export function toNotificationDTO(record: NotificationRecord): NotificationDTO {
  return {
    id: record.id,
    type: record.type,
    channel: record.channel,
    recipient: record.recipient,
    subject: record.subject,
    body: record.body,
    status: record.status,
    error: record.error,
    readAt: record.readAt?.toISOString() ?? null,
    sentAt: record.sentAt?.toISOString() ?? null,
    metadata: record.metadata ?? {},
    createdAt: record.createdAt.toISOString(),
  };
}

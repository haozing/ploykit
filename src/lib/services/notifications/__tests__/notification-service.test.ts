import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: {
      notifications: {
        findMany: vi.fn(),
      },
      userProfiles: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(),
    select: vi.fn(() => ({
      from: vi.fn().mockResolvedValue([]),
    })),
  },
}));

vi.mock('@/lib/db', () => ({
  db: mockDb,
  requireUserContext: vi.fn((_userId, callback) => callback(mockDb)),
  withSystemContext: vi.fn((callback) => callback(mockDb)),
}));

vi.mock('@/lib/_core/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  createNotification,
  listNotificationHistory,
  listUnreadNotifications,
} from '../notification-service';

const now = new Date('2026-05-09T00:00:00.000Z');

function createNotificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notification_1',
    userId: 'user_1',
    type: 'plugin.notification',
    channel: 'in_app',
    recipient: 'user_1',
    subject: 'Hello',
    body: 'Body',
    status: 'sent',
    error: null,
    readAt: null,
    sentAt: now,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mockInsertReturning(row = createNotificationRow()): void {
  const returning = vi.fn().mockResolvedValue([row]);
  const values = vi.fn().mockReturnValue({ returning });
  mockDb.insert.mockReturnValue({ values });
}

function mockCountResult(count: number): void {
  const where = vi.fn().mockResolvedValue([{ count }]);
  const from = vi.fn().mockReturnValue({ where });
  mockDb.select.mockReturnValue({ from });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockReturnValue({
    from: vi.fn().mockResolvedValue([]),
  });
  mockDb.query.userProfiles.findFirst.mockResolvedValue({
    preferences: {
      notificationSettings: {
        inAppEnabled: true,
        emailEnabled: true,
        emailAddress: 'user@example.test',
      },
    },
  });
});

describe('notification service', () => {
  it('creates an in-app notification when preferences allow it', async () => {
    mockInsertReturning();

    const result = await createNotification({
      userId: 'user_1',
      type: 'plugin.notification',
      channel: 'in-app',
      subject: 'Hello',
      body: 'Body',
      metadata: { pluginId: 'seo' },
    });

    expect(result).toMatchObject({
      id: 'notification_1',
      channel: 'in_app',
      status: 'sent',
      sentAt: now.toISOString(),
    });

    const values = mockDb.insert.mock.results[0].value.values;
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        channel: 'in_app',
        recipient: 'user_1',
        status: 'sent',
        metadata: { pluginId: 'seo' },
      })
    );
  });

  it('skips in-app notification when user disabled the channel', async () => {
    mockDb.query.userProfiles.findFirst.mockResolvedValue({
      preferences: {
        notificationSettings: {
          inAppEnabled: false,
        },
      },
    });

    const result = await createNotification({
      userId: 'user_1',
      type: 'plugin.notification',
      channel: 'in-app',
      body: 'Body',
    });

    expect(result).toBeNull();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('queues email notifications using the preference email address', async () => {
    mockInsertReturning(
      createNotificationRow({
        channel: 'email',
        recipient: 'user@example.test',
        status: 'pending',
        sentAt: null,
      })
    );

    await createNotification({
      userId: 'user_1',
      type: 'billing.payment_failed',
      channel: 'email',
      subject: 'Payment failed',
      body: 'Please update payment method.',
    });

    const values = mockDb.insert.mock.results[0].value.values;
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        recipient: 'user@example.test',
        status: 'pending',
        sentAt: null,
      })
    );
  });

  it('lists unread in-app notifications', async () => {
    mockDb.query.notifications.findMany.mockResolvedValue([createNotificationRow()]);

    const result = await listUnreadNotifications({ userId: 'user_1', limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'notification_1',
      channel: 'in_app',
      status: 'sent',
    });
  });

  it('lists notification history with pagination', async () => {
    mockDb.query.notifications.findMany.mockResolvedValue([createNotificationRow()]);
    mockCountResult(1);

    const result = await listNotificationHistory({ userId: 'user_1', limit: 10, offset: 0 });

    expect(result.notifications).toHaveLength(1);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });
});

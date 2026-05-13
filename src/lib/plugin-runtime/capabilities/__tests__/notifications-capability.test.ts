import { beforeEach, describe, expect, it, vi } from 'vitest';
import { definePlugin, Permission } from '@ploykit/plugin-sdk';

const { createNotificationMock } = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
}));

vi.mock('@/lib/services/notifications/notification-service', () => ({
  createNotification: createNotificationMock,
}));

import { normalizePluginRuntimeContract } from '../../contract';
import { createPluginRuntimeContext } from '../../context';

function createContract() {
  return normalizePluginRuntimeContract(
    definePlugin({
      id: 'notify-test',
      name: 'Notify Test',
      version: '1.0.0',
      permissions: [Permission.NotificationsSend],
      routes: {},
    })
  );
}

describe('notifications capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createNotificationMock.mockResolvedValue({
      id: 'notification_1',
    });
  });

  it('uses the production notification host by default', async () => {
    const context = createPluginRuntimeContext({
      contract: createContract(),
      request: new Request('https://test.local/api/plugins/notify-test/notifications'),
      requestId: 'request-1',
      user: { id: 'user_1', role: 'user' },
    });

    const result = await context.notifications.send({
      message: 'Ready',
      channel: 'in-app',
      subject: 'Plugin ready',
      metadata: { taskId: 'task_1' },
    });

    expect(result).toEqual({
      id: 'notification_1',
      queued: false,
    });
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: 'user_1',
      type: 'notify-test.notification',
      channel: 'in-app',
      subject: 'Plugin ready',
      body: 'Ready',
      metadata: {
        pluginId: 'notify-test',
        requestId: 'request-1',
        taskId: 'task_1',
      },
    });
  });

  it('returns a skipped id when preferences prevent notification creation', async () => {
    createNotificationMock.mockResolvedValue(null);
    const context = createPluginRuntimeContext({
      contract: createContract(),
      request: new Request('https://test.local/api/plugins/notify-test/notifications'),
      user: { id: 'user_1', role: 'user' },
    });

    const result = await context.notifications.send({
      message: 'Ready',
      channel: 'email',
    });

    expect(result.id).toMatch(/^notification_skipped_/);
    expect(result.queued).toBe(false);
  });
});

import { randomUUID } from 'crypto';
import {
  Permission,
  PluginError,
  type PluginNotificationInput,
  type PluginNotificationResult,
  type PluginNotifications,
} from '@ploykit/plugin-sdk';
import {
  assertJsonSerializable,
  enforceCapabilityPermission,
  requireUserOrSystem,
  type PluginCapabilityScope,
} from './guards.server';
import { createNotification } from '@/lib/services/notifications/notification-service';

export interface PluginNotificationDelivery
  extends Required<Pick<PluginNotificationInput, 'message'>> {
  pluginId: string;
  requestId: string;
  recipientUserId: string;
  channel: NonNullable<PluginNotificationInput['channel']>;
  subject?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginNotificationsHost {
  send(input: PluginNotificationDelivery): Promise<PluginNotificationResult>;
}

export interface CreatePluginNotificationsOptions {
  host?: Partial<PluginNotificationsHost>;
}

const defaultNotificationsHost: PluginNotificationsHost = {
  async send(input) {
    const notification = await createNotification({
      userId: input.recipientUserId,
      type: `${input.pluginId}.notification`,
      channel: input.channel,
      subject: input.subject,
      body: input.message,
      metadata: {
        pluginId: input.pluginId,
        requestId: input.requestId,
        ...(input.metadata ?? {}),
      },
    });

    return {
      id: notification?.id ?? `notification_skipped_${randomUUID()}`,
      queued: input.channel !== 'in-app' && Boolean(notification),
    };
  },
};

function resolveHost(host?: Partial<PluginNotificationsHost>): PluginNotificationsHost {
  return {
    ...defaultNotificationsHost,
    ...host,
  };
}

function normalizeInput(
  scope: PluginCapabilityScope,
  input: PluginNotificationInput
): PluginNotificationDelivery {
  const rawMessage = typeof input.message === 'string' ? input.message : '';
  const message = rawMessage.trim();
  if (!message) {
    throw new PluginError({
      code: 'PLUGIN_NOTIFICATION_MESSAGE_REQUIRED',
      message: 'ctx.notifications.send requires a non-empty message.',
      statusCode: 400,
      details: {
        pluginId: scope.contract.id,
      },
    });
  }

  if (input.channel && input.channel !== 'in-app' && input.channel !== 'email') {
    throw new PluginError({
      code: 'PLUGIN_NOTIFICATION_CHANNEL_INVALID',
      message: `ctx.notifications.send channel "${String(input.channel)}" is not supported.`,
      statusCode: 400,
      fix: 'Use "in-app" or "email" as the notification channel.',
      details: {
        pluginId: scope.contract.id,
        channel: input.channel,
      },
    });
  }

  const recipientUserId = input.recipientUserId ?? scope.user?.id;
  if (!recipientUserId) {
    throw new PluginError({
      code: 'PLUGIN_NOTIFICATION_RECIPIENT_REQUIRED',
      message: 'ctx.notifications.send requires recipientUserId when no plugin user is present.',
      statusCode: 400,
      fix: 'Pass recipientUserId or call this capability in an authenticated user context.',
      details: {
        pluginId: scope.contract.id,
      },
    });
  }

  assertJsonSerializable(input.metadata ?? {}, 'Notification metadata');

  return {
    pluginId: scope.contract.id,
    requestId: scope.requestId,
    recipientUserId,
    channel: input.channel ?? 'in-app',
    subject: input.subject,
    message,
    metadata: input.metadata,
  };
}

export function createPluginNotificationsCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginNotificationsOptions = {}
): PluginNotifications {
  const host = resolveHost(options.host);

  return {
    async send(input) {
      enforceCapabilityPermission(scope, Permission.NotificationsSend, 'ctx.notifications.send');
      requireUserOrSystem(scope, 'ctx.notifications.send');

      return host.send(normalizeInput(scope, input));
    },
  };
}

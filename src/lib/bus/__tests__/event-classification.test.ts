import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventBus } from '../event-bus';
import { getEventClass } from '../event-classification';
import { MemoryOutboxStore } from '../transports/outbox-store';
import { cleanupEventBus, waitForEventProcessing } from './helpers';

describe('event classification', () => {
  let eventBus: EventBus | undefined;

  afterEach(() => {
    if (eventBus) {
      cleanupEventBus(eventBus);
    }
  });

  it('classifies billing, webhook, plugin, audit, and usage events as critical', () => {
    expect(getEventClass('billing.order.created')).toBe('critical');
    expect(getEventClass('webhook.processed')).toBe('critical');
    expect(getEventClass('plugin.enabled')).toBe('critical');
    expect(getEventClass('audit.security.changed')).toBe('critical');
    expect(getEventClass('usage.api_quota.recorded')).toBe('critical');
  });

  it('routes critical events to outbox and standard events to local transport by default', async () => {
    const store = new MemoryOutboxStore();
    eventBus = new EventBus({ outboxStore: store });
    const criticalHandler = vi.fn().mockResolvedValue(undefined);
    const standardHandler = vi.fn().mockResolvedValue(undefined);

    eventBus.on('billing.order.created', 'billing-plugin', criticalHandler);
    eventBus.on('user.updated', 'profile-plugin', standardHandler);

    await eventBus.emit('billing.order.created', 'billing-service', { orderId: 'ord_123' });
    await eventBus.emit('user.updated', 'user-service', { userId: 'user_123' });
    await waitForEventProcessing(50);

    expect(criticalHandler).toHaveBeenCalledTimes(1);
    expect(standardHandler).toHaveBeenCalledTimes(1);
    await expect(store.getStats()).resolves.toMatchObject({
      total: 1,
      completed: 1,
    });
  });
});

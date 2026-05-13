import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../event-bus';
import { cleanupEventBus, waitForEventProcessing } from './helpers';

describe('EventBus outbox transport', () => {
  let eventBus: EventBus | undefined;

  afterEach(() => {
    if (eventBus) {
      cleanupEventBus(eventBus);
    }
  });

  it('uses the outbox transport when configured', async () => {
    eventBus = new EventBus({ transport: 'outbox' });
    const handler = vi.fn().mockResolvedValue(undefined);

    eventBus.on('billing.order.created', 'billing-plugin', handler);
    await eventBus.emit('billing.order.created', 'billing-service', { orderId: 'ord_123' });

    await waitForEventProcessing(50);

    expect(handler).toHaveBeenCalledWith(
      { orderId: 'ord_123' },
      expect.objectContaining({ emitterId: 'billing-service' })
    );
  });

  it('adds a traceable event envelope and preserves caller metadata overrides', async () => {
    eventBus = new EventBus({ transport: 'outbox' });
    const handler = vi.fn().mockResolvedValue(undefined);

    eventBus.on('billing.order.created', 'billing-plugin', handler);
    await eventBus.emit(
      'billing.order.created',
      'billing-service',
      { orderId: 'ord_123' },
      {
        correlationId: 'checkout-session-1',
        causationId: 'stripe:evt_1',
        idempotencyKey: 'stripe:evt_1:billing.order.created',
      }
    );

    await waitForEventProcessing(50);

    expect(handler).toHaveBeenCalledWith(
      { orderId: 'ord_123' },
      expect.objectContaining({
        emitterId: 'billing-service',
        eventId: expect.any(String),
        correlationId: 'checkout-session-1',
        causationId: 'stripe:evt_1',
        idempotencyKey: 'stripe:evt_1:billing.order.created',
      })
    );
  });
});

import type {
  RuntimeStoreCommercialOrder,
  RuntimeStoreCommercialOrderStatus,
} from '../../module-runtime/stores';
import type {
  CommercialOrderEventPublisher,
  CommercialOrderStatusEventPayload,
  CommercialOrderStatusEventReason,
} from './commercial-ledger-types';

interface CreateCommercialLedgerEventsInput {
  eventName: string;
  events?: CommercialOrderEventPublisher;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
}

type PublishOrderStatusEventInput = {
  order: RuntimeStoreCommercialOrder;
  previousStatus: RuntimeStoreCommercialOrderStatus;
  reason: CommercialOrderStatusEventReason;
  provider: string;
  providerRef: string;
  refund?: {
    creditNoteId: string;
    amount: number;
    currency: string;
    reason: string;
  };
};

export function createCommercialLedgerEvents({
  eventName,
  events,
  scope,
}: CreateCommercialLedgerEventsInput): {
  publishOrderStatusEvent(input: PublishOrderStatusEventInput): Promise<void>;
} {
  async function publishOrderStatusEvent(input: PublishOrderStatusEventInput): Promise<void> {
    if (!events) {
      return;
    }

    const payload: CommercialOrderStatusEventPayload = {
      orderId: input.order.id,
      productId: scope.productId,
      workspaceId: scope.workspaceId ?? null,
      userId: input.order.userId,
      sku: input.order.sku,
      amount: input.order.amount,
      currency: input.order.currency,
      previousStatus: input.previousStatus,
      status: input.order.status,
      reason: input.reason,
      provider: input.provider,
      providerRef: input.providerRef,
      occurredAt: input.order.updatedAt,
      ...(input.refund
        ? {
            refund: {
              ...input.refund,
              provider: input.provider,
              providerRef: input.providerRef,
            },
          }
        : {}),
    };

    await events.publish({
      name: eventName,
      payload,
      correlationId: `commercial-order:${input.order.id}`,
      causationId: input.refund?.creditNoteId ?? input.providerRef,
      idempotencyKey: `${eventName}:${input.order.id}:${input.order.status}`,
      maxAttempts: 5,
    });
  }

  return { publishOrderStatusEvent };
}

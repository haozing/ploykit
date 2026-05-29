export const HOST_COMMERCIAL_ORDER_STATUS_EVENT_NAME = 'commercial.order.status_updated';

export const HostEvent = {
  CommercialOrderStatusUpdated: HOST_COMMERCIAL_ORDER_STATUS_EVENT_NAME,
} as const;

export type HostCommercialOrderStatus =
  | 'created'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'canceled';

export type HostCommercialOrderStatusEventReason =
  | 'provider.checkout.paid'
  | 'provider.refund.full';

export interface HostCommercialOrderStatusEventPayload {
  orderId: string;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  sku: string;
  amount: number;
  currency: string;
  previousStatus: HostCommercialOrderStatus;
  status: HostCommercialOrderStatus;
  reason: HostCommercialOrderStatusEventReason;
  provider?: string | null;
  providerRef?: string | null;
  occurredAt: string;
  refund?: {
    creditNoteId: string;
    amount: number;
    currency: string;
    reason: string;
    provider: string;
    providerRef: string;
  };
}

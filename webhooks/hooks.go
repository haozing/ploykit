package webhooks

import "context"

type WebhookHooks struct {
	OnDeliveryFailed func(ctx context.Context, workspaceID, subscriptionID, deliveryID, eventType, reason string) error

	OnSubscriptionDisabled func(ctx context.Context, workspaceID, subscriptionID string) error
}

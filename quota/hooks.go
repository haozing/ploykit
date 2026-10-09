package quota

import "context"

type QuotaHooks struct {
	OnNearLimit func(ctx context.Context, workspaceID, key string, used, limit int64) error

	OnExhausted func(ctx context.Context, workspaceID, key string) error

	OnGrant func(ctx context.Context, workspaceID, key, reason, refID string, amount int) error

	OnReservationExpired func(ctx context.Context, reservationID, workspaceID, quotaKey string, amount int64) error
}

package app

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type BillingHooks struct {
	BeforeCheckout func(ctx context.Context, workspaceID, userID, planCode string) error

	OnPlanChanged func(ctx context.Context, workspaceID, from, to string) error

	OnPlanChangedTx func(ctx context.Context, tx pgx.Tx, workspaceID, from, to string) error

	OnPaymentFailed func(ctx context.Context, workspaceID, orderID, reason string) error

	OnSubscriptionRenewed func(ctx context.Context, workspaceID string, expiresAt time.Time) error

	OnMeteredOverage func(ctx context.Context, workspaceID, orderID, period string, items int, amountCents int64) error
}

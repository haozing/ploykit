package identity

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type IdentityHooks struct {
	AfterRegister func(ctx context.Context, tx pgx.Tx, userID string) error

	AfterLogin func(ctx context.Context, userID, sessionID string) error

	OnLoginFailed func(ctx context.Context, email, ipHash string) error

	AfterPasswordChange func(ctx context.Context, userID string) error
}

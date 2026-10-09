package workspace

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type WorkspaceHooks struct {
	AfterCreate func(ctx context.Context, tx pgx.Tx, workspaceID, ownerID string) error

	BeforeDelete func(ctx context.Context, workspaceID string) error

	OnTeardown func(ctx context.Context, tx pgx.Tx, workspaceID string) error

	AfterMemberJoin func(ctx context.Context, tx pgx.Tx, workspaceID, userID, role string) error

	BeforeMemberRemove func(ctx context.Context, workspaceID, userID string) error

	OnMemberRemoved func(ctx context.Context, workspaceID, userID string) error

	BeforeOwnerChange func(ctx context.Context, workspaceID, fromUserID, toUserID string) error

	OnOwnerTransfer func(ctx context.Context, workspaceID, fromUserID, toUserID string) error
}

package pg

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

func TestWithTenantRejectsNesting(t *testing.T) {
	outer := Identity{WorkspaceID: uuid.New(), UserID: uuid.New()}
	ctx := context.WithValue(context.Background(), tenantKey{}, outer)
	inner := Identity{WorkspaceID: uuid.New(), UserID: uuid.New()}

	err := WithTenant(ctx, nil, inner, func(context.Context, pgx.Tx) error { return nil })
	require.Error(t, err, "嵌套 WithTenant 应被拒绝")
	require.Contains(t, err.Error(), "nested")
}

func TestWithServiceRejectsInsideWithTenant(t *testing.T) {
	ctx := context.WithValue(context.Background(), tenantKey{},
		Identity{WorkspaceID: uuid.New(), UserID: uuid.New()})

	err := WithService(ctx, nil, func(context.Context, pgx.Tx) error { return nil })
	require.Error(t, err, "租户事务内的 WithService 应被拒绝")
	require.Contains(t, err.Error(), "inside WithTenant")
}

func TestWithTenantGUCScopedToTransaction(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	id := Identity{WorkspaceID: uuid.New(), UserID: uuid.New()}

	var inside string
	require.NoError(t, WithTenant(ctx, db, id, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT current_setting('`+gucWorkspaceID+`', true)`).Scan(&inside)
	}), "WithTenant 内读取 GUC")
	require.Equal(t, id.WorkspaceID.String(), inside)

	gone := func() bool {
		t.Helper()
		var gone bool
		require.NoError(t, db.Tx(ctx).QueryRow(ctx,
			`SELECT nullif(current_setting('`+gucWorkspaceID+`', true), '') IS NULL`).Scan(&gone))
		return gone
	}
	require.True(t, gone(), "提交后不得再携带租户上下文（访问器口径），否则池化下会跨租户泄漏")

	boom := errors.New("rollback probe")
	require.ErrorIs(t, WithTenant(ctx, db, id, func(context.Context, pgx.Tx) error {
		return boom
	}), boom)
	require.True(t, gone(), "回滚后同样不得携带租户上下文")
}

func TestWithServiceInjectsNoContext(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	id := Identity{WorkspaceID: uuid.New(), UserID: uuid.New()}
	require.NoError(t, WithTenant(ctx, db, id, func(context.Context, pgx.Tx) error { return nil }))

	require.NoError(t, WithService(ctx, db, func(ctx context.Context, tx pgx.Tx) error {
		var isNull bool
		if err := tx.QueryRow(ctx,
			`SELECT nullif(current_setting('`+gucWorkspaceID+`', true), '') IS NULL`).Scan(&isNull); err != nil {
			return err
		}
		require.True(t, isNull, "WithService 不应注入租户上下文（访问器口径，容忍空串占位符）")
		_, err := tx.Exec(ctx, `SELECT 1`)
		return err
	}))
}

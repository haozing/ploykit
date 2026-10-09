package pgrepo

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func seedWorkspace(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	wsID := uuid.NewString()
	suffix := uuid.NewString()[:8]
	_, err := pool.Exec(context.Background(),
		`INSERT INTO "user" (id, email) VALUES ($1, $2)`, uid, fmt.Sprintf("az26-%s@test.dev", suffix))
	require.NoError(t, err)
	_, err = pool.Exec(context.Background(),
		`INSERT INTO workspace (id, slug, name, plan_code, created_by) VALUES ($1, $2, 'AZ26测试区', 'free', $3)`,
		wsID, "az26-"+suffix, uid)
	require.NoError(t, err)
	t.Cleanup(func() {
		cctx := context.Background()
		_, _ = pool.Exec(cctx, `DELETE FROM workspace WHERE id = $1`, wsID)
		_, _ = pool.Exec(cctx, `DELETE FROM "user" WHERE id = $1`, uid)
	})
	return wsID
}

func TestPermsForThreeStates_WA2(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	wsID := seedWorkspace(t, pool)

	key := authz.RoleKey{WorkspaceID: wsID, Role: authz.RoleMember}

	perms, err := repo.PermsFor(ctx, key)
	require.NoError(t, err)
	assert.Nil(t, perms, "无配置行应返回 nil（回落内置映射）")

	_, err = pool.Exec(ctx,
		`INSERT INTO workspace_role (workspace_id, role, perms) VALUES ($1, $2, '[]'::jsonb)`,
		wsID, authz.RoleMember)
	require.NoError(t, err)
	perms, err = repo.PermsFor(ctx, key)
	require.NoError(t, err)
	assert.NotNil(t, perms, "空数组配置行必须返回非 nil 空集（显式清零，不得回落内置）")
	assert.Empty(t, perms)

	_, err = pool.Exec(ctx,
		`UPDATE workspace_role SET perms = '["tasks:write","tasks:read"]'::jsonb WHERE workspace_id = $1 AND role = $2`,
		wsID, authz.RoleMember)
	require.NoError(t, err)
	perms, err = repo.PermsFor(ctx, key)
	require.NoError(t, err)
	assert.ElementsMatch(t, []authz.Permission{"tasks:read", "tasks:write"}, perms)
}

func TestExplicitEmptyDeniesEverything_WA2(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	wsID := seedWorkspace(t, pool)

	_, err := pool.Exec(ctx,
		`INSERT INTO workspace_role (workspace_id, role, perms) VALUES ($1, $2, '[]'::jsonb)`,
		wsID, authz.RoleOwner)
	require.NoError(t, err)

	a := authz.New(nil, nil, authz.WithProvider(New(pool)), authz.WithCacheTTL(0))
	owner := &webx.Principal{UserID: uuid.NewString(), WorkspaceID: wsID, Role: authz.RoleOwner}

	assert.False(t, a.CanIn(ctx, owner, "workspace:delete"),
		"显式清零后 owner 的内置权限也必须被拒（不回落内置）")
	assert.False(t, a.CanIn(ctx, owner, "workspace:read"), "清零角色拒绝一切权限点")

	_, err = pool.Exec(ctx, `DELETE FROM workspace_role WHERE workspace_id = $1`, wsID)
	require.NoError(t, err)
	assert.True(t, a.CanIn(ctx, owner, "workspace:delete"), "删配置行后应回落内置映射")
}

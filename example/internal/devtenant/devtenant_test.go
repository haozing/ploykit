package devtenant

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 幂等合同：两次 Ensure 结论一致、只建一份；第二次命中"已存在"路径。
func TestEnsure_Idempotent(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool := newPool(t, dsn)
	ctx := context.Background()
	suffix := wsSuffix()

	r1, err := Ensure(ctx, pool, nil, &Options{
		Email:         "dt-" + suffix + "@test.local",
		WorkspaceSlug: "dt-" + suffix,
		WorkspaceName: "DT " + suffix,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, r1.UserID)
	assert.NotEmpty(t, r1.WorkspaceID)
	assert.False(t, r1.WorkspaceExist, "首次应新建")
	assert.Equal(t, r1.Email, r1.Email)

	r2, err := Ensure(ctx, pool, nil, &Options{
		Email:         "dt-" + suffix + "@test.local",
		WorkspaceSlug: "dt-" + suffix,
	})
	require.NoError(t, err)
	assert.True(t, r2.WorkspaceExist, "第二次应命中已存在")
	assert.Equal(t, r1.UserID, r2.UserID, "user 幂等")
	assert.Equal(t, r1.WorkspaceID, r2.WorkspaceID, "workspace 幂等")

	// 默认值合同：Email/Slug 未指定时落到约定标识
	var email, slug string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT u.email, w.slug FROM "user" u JOIN workspace w ON w.created_by = u.id WHERE u.id = $1 AND w.id = $2`,
		r1.UserID, r1.WorkspaceID).Scan(&email, &slug))
	assert.Equal(t, "dt-"+suffix+"@test.local", email)
	assert.Equal(t, "dt-"+suffix, slug)

	cleanup(t, pool, r1.UserID, r1.WorkspaceID)
}

// owner 语义：置备出的 workspace 的唯一成员是 owner 角色的默认用户。
func TestEnsure_OwnerMembership(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool := newPool(t, dsn)
	ctx := context.Background()
	suffix := wsSuffix()

	r, err := Ensure(ctx, pool, nil, &Options{
		Email:         "dtown-" + suffix + "@test.local",
		WorkspaceSlug: "dtown-" + suffix,
	})
	require.NoError(t, err)

	var role string
	var n int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT m.role, count(*) OVER () FROM member m WHERE m.workspace_id = $1 AND m.user_id = $2`,
		r.WorkspaceID, r.UserID).Scan(&role, &n))
	assert.Equal(t, "owner", role)
	assert.Equal(t, 1, n, "应恰好一个成员")

	cleanup(t, pool, r.UserID, r.WorkspaceID)
}

func newPool(t *testing.T, dsn string) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func cleanup(t *testing.T, pool *pgxpool.Pool, userID, wsID string) {
	t.Helper()
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `DELETE FROM member WHERE workspace_id = $1`, wsID)
	_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsID)
	_, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, userID)
}

func wsSuffix() string { return time.Now().UTC().Format("150405") } // slug 约束 [a-z0-9][a-z0-9-]{2,38}[a-z0-9]：纯数字安全

package admin_test

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/admin"
	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pgmigrate"
)

func newTestLogger(buf *strings.Builder) *slog.Logger {
	return slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

// BootstrapPlatformAdmin is a startup-time SQL routine over the shared user
// table; tests follow the repo integration-test convention (TEST_DATABASE_URL,
// skip when absent) and run migrations defensively so a fresh database works.
func openBootDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	require.NoError(t, pgmigrate.Up(context.Background(), pool, migrations.FS, "."))
	return pool
}

// clearPlatformAdmins demotes every platform admin for the duration of a test
// (the bootstrap's 0→1 branches need an empty slate, even on a shared test
// database) and restores the original admins on cleanup.
func clearPlatformAdmins(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	rows, err := pool.Query(ctx, `SELECT email FROM "user" WHERE is_platform_admin`)
	require.NoError(t, err)
	var admins []string
	for rows.Next() {
		var e string
		require.NoError(t, rows.Scan(&e))
		admins = append(admins, e)
	}
	require.NoError(t, rows.Err())
	if len(admins) > 0 {
		_, err = pool.Exec(ctx, `UPDATE "user" SET is_platform_admin = false WHERE is_platform_admin`)
		require.NoError(t, err)
	}
	t.Cleanup(func() {
		cctx := context.Background()
		for _, e := range admins {
			_, _ = pool.Exec(cctx, `UPDATE "user" SET is_platform_admin = true WHERE lower(email) = $1`, e)
		}
	})
}

func seedBootUser(t *testing.T, pool *pgxpool.Pool, email string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `INSERT INTO "user" (email) VALUES ($1)`, email)
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM "user" WHERE lower(email) = $1`, strings.ToLower(email)) })
}

func bootAdminCount(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT count(*) FROM "user" WHERE is_platform_admin`).Scan(&n))
	return n
}

func bootIsAdmin(t *testing.T, pool *pgxpool.Pool, email string) bool {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT count(*) FROM "user" WHERE is_platform_admin AND lower(email) = $1`, strings.ToLower(email)).Scan(&n))
	return n > 0
}

func TestBootstrapPlatformAdmin_Branches(t *testing.T) {
	pool := openBootDB(t)
	ctx := context.Background()

	cases := []struct {
		name         string
		email        string // bootstrap argument
		seedUser     string // pre-registered user email ("" = none)
		seedAdmin    string // pre-existing platform admin ("" = none)
		wantErr      bool
		wantPromoted bool // the bootstrap email ends up platform admin
		wantLogSub   string
		wantLogWarn  bool
	}{
		{
			name: "空白 email → info 跳过（功能关闭）",
			email: "   ",
			seedUser: "boot-blank@test.dev",
			wantPromoted: false,
			wantLogSub: "skipping",
		},
		{
			name: "已有平台管理员 → 跳过（只升不降、绝不提第二个号）",
			email: "boot-target@test.dev",
			seedUser: "boot-target@test.dev",
			seedAdmin: "boot-incumbent@test.dev",
			wantPromoted: false,
			wantLogSub: "already exists",
		},
		{
			name: "count==0 且用户已注册 → 提升首个管理员（大小写不敏感 + trim）",
			email: "  Bootstrap.Case@Example.COM  ",
			seedUser: "bootstrap.case@example.com",
			wantPromoted: true,
			wantLogSub: "promoted first platform admin",
		},
		{
			name: "邮箱未注册 → warn 跳过不报错（先部署后注册合法）",
			email: "boot-missing@test.dev",
			wantPromoted: false,
			wantLogSub: "no user with this email yet",
			wantLogWarn: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clearPlatformAdmins(t, pool)
			if tc.seedUser != "" {
				seedBootUser(t, pool, tc.seedUser)
			}
			if tc.seedAdmin != "" {
				seedBootUser(t, pool, tc.seedAdmin)
				_, err := pool.Exec(ctx, `UPDATE "user" SET is_platform_admin = true WHERE lower(email) = $1`, tc.seedAdmin)
				require.NoError(t, err)
			}
			before := bootAdminCount(t, pool)

			var buf strings.Builder
			log := newTestLogger(&buf)
			err := admin.BootstrapPlatformAdmin(ctx, pool, tc.email, log)

			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.wantPromoted, bootIsAdmin(t, pool, strings.ToLower(strings.TrimSpace(tc.email))),
				"bootstrap email promoted = %v", tc.wantPromoted)
			assert.Equal(t, before, bootAdminCount(t, pool)-boolToInt(tc.wantPromoted),
				"管理员总数只应因本次提升而 +1")

			out := buf.String()
			assert.Contains(t, out, tc.wantLogSub)
			if tc.wantLogWarn {
				assert.Contains(t, out, "level=WARN")
			} else {
				assert.Contains(t, out, "level=INFO")
			}
		})
	}
}

func TestBootstrapPlatformAdmin_Idempotent(t *testing.T) {
	pool := openBootDB(t)
	ctx := context.Background()
	clearPlatformAdmins(t, pool)
	// the column CHECK (email = lower(email)) enforces lowercase storage, so
	// the seed is lowercase and the bootstrap argument exercises normalization
	seedBootUser(t, pool, "boot-idempotent@test.dev")

	require.NoError(t, admin.BootstrapPlatformAdmin(ctx, pool, "Boot-Idempotent@Test.dev", nil))
	require.True(t, bootIsAdmin(t, pool, "boot-idempotent@test.dev"))

	// second boot on an already-promoted database: no error, no second admin
	require.NoError(t, admin.BootstrapPlatformAdmin(ctx, pool, "boot-idempotent@test.dev", nil))
	assert.Equal(t, 1, bootAdminCount(t, pool), "重复调用绝不产生第二个管理员")
	assert.True(t, bootIsAdmin(t, pool, "boot-idempotent@test.dev"), "首个管理员保持不变")
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

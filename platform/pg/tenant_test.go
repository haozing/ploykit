package pg

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
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

func TestTenantSingleShotRejectsNesting(t *testing.T) {
	outer := Identity{WorkspaceID: uuid.New(), UserID: uuid.New()}
	inner := Identity{WorkspaceID: uuid.New(), UserID: uuid.New()}

	tenantCtx := context.WithValue(context.Background(), tenantKey{}, outer)
	_, err := TenantExec(tenantCtx, nil, inner, `SELECT 1`)
	require.Error(t, err, "TenantExec 在租户作用域内应被拒绝")
	require.Contains(t, err.Error(), "nested")
	err = TenantScan(tenantCtx, nil, inner, `SELECT 1`, nil, new(any))
	require.Error(t, err, "TenantScan 在租户作用域内应被拒绝")
	require.Contains(t, err.Error(), "nested")

	// 一个非 nil 的 pgx.Tx 站位（nil 接口转 any 会整体为 nil, 断言不触发）。
	txCtx := context.WithValue(context.Background(), txKey{}, fakeTx{})
	_, err = TenantExec(txCtx, nil, inner, `SELECT 1`)
	require.Error(t, err, "TenantExec 在既有事务内应被拒绝")
	require.Contains(t, err.Error(), "transaction boundary")
	err = TenantScan(txCtx, nil, inner, `SELECT 1`, nil, new(any))
	require.Error(t, err, "TenantScan 在既有事务内应被拒绝")
	require.Contains(t, err.Error(), "transaction boundary")
}

// fakeTx 只为构造非 nil 的 pgx.Tx 上下文值，守护逻辑不会调用它。
type fakeTx struct{ pgx.Tx }

// TestTenantExecAndScan exercises the single-shot helpers the way a product
// must run them: a NOSUPERUSER NOBYPASSRLS role behind a GUC-policy table
// (same shape as example/internal/task/rls_test.go). The superuser would
// bypass every policy, so the assertions run through a second pool connected
// as the restricted role.
func TestTenantExecAndScan(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	const (
		role = "tenant_probe_role"
		pass = "tenant_probe_role"
		tbl  = "pg_tenant_probe_tbl"
	)

	fixtures := []string{
		fmt.Sprintf(`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%s') THEN
				DROP OWNED BY %s;
				DROP ROLE %s;
			END IF;
		END $$;`, role, role, role),
		fmt.Sprintf(`DROP TABLE IF EXISTS %s`, tbl),
		fmt.Sprintf(`CREATE ROLE %s LOGIN PASSWORD '%s' NOSUPERUSER NOBYPASSRLS`, role, pass),
		fmt.Sprintf(`CREATE TABLE %s (workspace_id uuid NOT NULL, label text)`, tbl),
		fmt.Sprintf(`ALTER TABLE %s ENABLE ROW LEVEL SECURITY`, tbl),
		fmt.Sprintf(`ALTER TABLE %s FORCE ROW LEVEL SECURITY`, tbl),
		fmt.Sprintf(`CREATE POLICY %[1]s_tenant ON %[1]s
			USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
			WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid)`, tbl),
		fmt.Sprintf(`GRANT USAGE ON SCHEMA public TO %s`, role),
		fmt.Sprintf(`GRANT SELECT, INSERT, DELETE ON %s TO %s`, tbl, role),
	}
	require.NoError(t, WithService(ctx, db, func(ctx context.Context, tx pgx.Tx) error {
		for _, stmt := range fixtures {
			if _, err := tx.Exec(ctx, stmt); err != nil {
				return fmt.Errorf("%s: %w", stmt, err)
			}
		}
		return nil
	}), "构造成 RLS 探针表")
	t.Cleanup(func() {
		cctx := context.Background()
		_ = WithService(cctx, db, func(ctx context.Context, tx pgx.Tx) error {
			for _, stmt := range []string{
				fmt.Sprintf(`DROP TABLE IF EXISTS %s`, tbl),
				fmt.Sprintf(`DROP OWNED BY %s`, role),
				fmt.Sprintf(`DROP ROLE IF EXISTS %s`, role),
			} {
				if _, err := tx.Exec(cctx, stmt); err != nil {
					return err
				}
			}
			return nil
		})
	})

	// Second pool as the restricted role — the superuser would bypass RLS.
	dsn := os.Getenv("TEST_DATABASE_URL")
	require.NotEmpty(t, dsn)
	cfg, err := pgxpool.ParseConfig(dsn)
	require.NoError(t, err)
	cfg.ConnConfig.User = role
	cfg.ConnConfig.Password = pass
	cfg.MaxConns = 2
	appPool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)
	t.Cleanup(appPool.Close)
	app := WrapPool(appPool)

	wsA, wsB := uuid.New(), uuid.New()
	idA := Identity{WorkspaceID: wsA, UserID: uuid.New()}
	seed := func(ws uuid.UUID, labels ...string) {
		t.Helper()
		require.NoError(t, WithTenant(ctx, db, Identity{WorkspaceID: ws, UserID: idA.UserID},
			func(ctx context.Context, tx pgx.Tx) error {
				for _, label := range labels {
					if _, err := tx.Exec(ctx,
						fmt.Sprintf(`INSERT INTO %s (workspace_id, label) VALUES ($1, $2)`, tbl), ws, label); err != nil {
						return err
					}
				}
				return nil
			}), "超级用户经 WithTenant 播种（owner 口径）")
	}
	seed(wsA, "a-1", "a-2")
	seed(wsB, "b-1")

	tag, err := TenantExec(ctx, app, idA,
		fmt.Sprintf(`INSERT INTO %s (workspace_id, label) VALUES ($1, $2)`, tbl), wsA, "a-3")
	require.NoError(t, err, "作用域内 INSERT 本租户行应成功")
	require.EqualValues(t, 1, tag.RowsAffected())

	_, err = TenantExec(ctx, app, idA,
		fmt.Sprintf(`INSERT INTO %s (workspace_id, label) VALUES ($1, $2)`, tbl), wsB, "cross-tenant")
	require.Error(t, err, "作用域内写他租户行应被 WITH CHECK 拒绝")
	var pgErr *pgconn.PgError
	require.ErrorAs(t, err, &pgErr)
	require.Equal(t, "42501", pgErr.Code, "RLS WITH CHECK 违约应为 42501, got %s: %s", pgErr.Code, pgErr.Message)

	var n int
	require.NoError(t, TenantScan(ctx, app, idA,
		fmt.Sprintf(`SELECT count(*) FROM %s`, tbl), nil, &n),
		"作用域内扫描本租户行")
	require.Equal(t, 3, n, "只见 wsA 的行（2 播种 + 1 插入）, got %d", n)

	var label string
	err = TenantScan(ctx, app, idA,
		fmt.Sprintf(`SELECT label FROM %s WHERE label = 'b-1'`, tbl), nil, &label)
	require.ErrorIs(t, err, pgx.ErrNoRows, "wsB 的行对 wsA 不可见, 应返回 no rows")

	var bCount int
	require.NoError(t, TenantScan(ctx, app, Identity{WorkspaceID: wsB, UserID: idA.UserID},
		fmt.Sprintf(`SELECT count(*) FROM %s WHERE label LIKE 'a-%%'`, tbl), nil, &bCount))
	require.Equal(t, 0, bCount, "反向口径：B 不应见 A 的行")

	require.Error(t, TenantScan(ctx, app, idA,
		`SELECT * FROM pg_tenant_probe_missing_table`, nil, new(any)),
		"TenantScan 应透出查询错误")

	var leaked bool
	require.NoError(t, app.Within(ctx, func(ctx context.Context) error {
		return app.Tx(ctx).QueryRow(ctx,
			`SELECT nullif(current_setting('`+gucWorkspaceID+`', true), '') IS NOT NULL`).Scan(&leaked)
	}))
	require.False(t, leaked, "单发调用提交后不得在池化连接上留下租户 GUC（会话级泄漏）")
}

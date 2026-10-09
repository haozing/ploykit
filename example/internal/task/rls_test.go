package task

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	pgm "github.com/haozing/ploykit/platform/pgmigrate"
)

const (
	rlsRole                  = "ploykit_app"
	rlsPassword              = "ploykit_app"
	rlsInsufficientPrivilege = "42501"
)

type rlsEnv struct {
	admin      *pg.DB
	app        *pg.DB
	appPool    *pgxpool.Pool
	userID     uuid.UUID
	wsA, wsB   uuid.UUID
	seedCountA int
	seedCountB int
}

func newRLSEnv(t *testing.T) *rlsEnv {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()

	admin, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	t.Cleanup(admin.Close)

	require.NoError(t, pgm.Up(ctx, admin.Pool(), migrations.FS, "."), "框架迁移链")
	require.NoError(t, applyProductMigrations(ctx, t, admin.Pool()), "产品迁移链 1001+")
	ensureRlsRole(ctx, t, admin.Pool())

	appPool := mustRlsAppPool(ctx, t, dsn)
	t.Cleanup(appPool.Close)

	e := &rlsEnv{
		admin:   admin,
		app:     pg.WrapPool(appPool),
		appPool: appPool,
		userID:  uuid.New(),
		wsA:     uuid.New(),
		wsB:     uuid.New(),
	}
	e.seed(t)
	t.Cleanup(func() {
		cctx := context.Background()

		_, _ = admin.Pool().Exec(cctx, `DELETE FROM workspace WHERE id IN ($1, $2)`, e.wsA, e.wsB)
		_, _ = admin.Pool().Exec(cctx, `DELETE FROM "user" WHERE id = $1`, e.userID)
	})
	return e
}

var prodMigrationRe = regexp.MustCompile(`^(\d{3,})_[a-z0-9_]+\.up\.sql$`)

func applyProductMigrations(ctx context.Context, t *testing.T, pool *pgxpool.Pool) error {
	t.Helper()
	const dir = "../../cmd/app/migrations"
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read %s: %w", dir, err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && prodMigrationRe.MatchString(e.Name()) {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		version := prodMigrationRe.FindStringSubmatch(name)[1]
		var applied bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		script := fmt.Sprintf("BEGIN;\n%s\nINSERT INTO schema_migrations(version) VALUES ('%s');\nCOMMIT;", string(body), version)
		conn, err := pool.Acquire(ctx)
		if err != nil {
			return err
		}
		_, execErr := conn.Conn().PgConn().Exec(ctx, script).ReadAll()
		conn.Release()
		if execErr != nil {
			return fmt.Errorf("apply %s: %w", name, execErr)
		}
	}
	return nil
}

func ensureRlsRole(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	var exists bool
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1)`, rlsRole).Scan(&exists))
	if !exists {
		_, err := pool.Exec(ctx, fmt.Sprintf(
			`CREATE ROLE %s LOGIN PASSWORD '%s' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
			rlsRole, rlsPassword))
		require.NoError(t, err, "创建 %s（需 TEST_DATABASE_URL 持 CREATEROLE）", rlsRole)
	}
	_, err := pool.Exec(ctx, fmt.Sprintf(`
		GRANT USAGE ON SCHEMA public, app TO %[1]s;
		GRANT SELECT, INSERT, UPDATE, DELETE ON task TO %[1]s;`, rlsRole))
	require.NoError(t, err)
}

func mustRlsAppPool(ctx context.Context, t *testing.T, dsn string) *pgxpool.Pool {
	t.Helper()
	cfg, err := pgxpool.ParseConfig(dsn)
	require.NoError(t, err)
	cfg.ConnConfig.User = rlsRole
	cfg.ConnConfig.Password = rlsPassword
	cfg.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)
	return pool
}

func (e *rlsEnv) seed(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	uniq := time.Now().UnixNano()
	_, err := e.admin.Pool().Exec(ctx,
		`INSERT INTO "user" (id, email, display_name) VALUES ($1, $2, 'rls test')`,
		e.userID, fmt.Sprintf("rls-%d@test.local", uniq))
	require.NoError(t, err)
	for i, ws := range []uuid.UUID{e.wsA, e.wsB} {
		_, err := e.admin.Pool().Exec(ctx,
			`INSERT INTO workspace (id, slug, name, created_by) VALUES ($1, $2, $3, $4)`,
			ws, fmt.Sprintf("rls-%d-%d", uniq, i), fmt.Sprintf("RLS-%d", i), e.userID)
		require.NoError(t, err)
	}
	seedTasks := func(ws uuid.UUID, titles ...string) int {
		id := pg.Identity{WorkspaceID: ws, UserID: e.userID}
		require.NoError(t, pg.WithTenant(ctx, e.admin, id, func(ctx context.Context, tx pgx.Tx) error {
			for n, title := range titles {
				if _, err := tx.Exec(ctx,
					`INSERT INTO task (workspace_id, number, title, created_by)
					 VALUES ($1, $2, $3, $4)`,
					ws, n+1, title, e.userID); err != nil {
					return err
				}
			}
			return nil
		}), "管理员经 WithTenant 写入种子（owner 口径的正向对照）")
		return len(titles)
	}
	e.seedCountA = seedTasks(e.wsA, "A-1", "A-2")
	e.seedCountB = seedTasks(e.wsB, "B-1")
}

func TestRLSTenantChannel(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()
	ids := []uuid.UUID{e.wsA, e.wsB}
	idA := pg.Identity{WorkspaceID: e.wsA, UserID: e.userID}

	t.Run("state1: WithTenant(A) 只见 A 的行", func(t *testing.T) {
		require.NoError(t, pg.WithTenant(ctx, e.app, idA, func(ctx context.Context, tx pgx.Tx) error {

			var gotWS uuid.UUID
			if err := tx.QueryRow(ctx, `SELECT app.workspace_id()`).Scan(&gotWS); err != nil {
				return err
			}
			require.Equal(t, e.wsA, gotWS)

			rows, err := tx.Query(ctx,
				`SELECT workspace_id FROM task WHERE workspace_id = ANY($1)`, ids)
			if err != nil {
				return err
			}
			defer rows.Close()
			seen := map[uuid.UUID]int{}
			for rows.Next() {
				var w uuid.UUID
				if err := rows.Scan(&w); err != nil {
					return err
				}
				seen[w]++
			}
			if err := rows.Err(); err != nil {
				return err
			}
			require.Len(t, seen, 1, "只见一个工作区, got %v", seen)
			require.Equal(t, e.seedCountA, seen[e.wsA], "A 的行数, got %v", seen)

			ct, err := tx.Exec(ctx,
				`INSERT INTO task (workspace_id, number, title, created_by)
				 VALUES ($1, $2, 'A-3', $3)`, e.wsA, e.seedCountA+1, e.userID)
			if err != nil {
				return err
			}
			require.EqualValues(t, 1, ct.RowsAffected())
			return nil
		}))
	})

	t.Run("state2: 不带上下文直查 0 行（fail-closed）", func(t *testing.T) {
		var n int
		require.NoError(t, e.app.Within(ctx, func(ctx context.Context) error {
			return e.app.Tx(ctx).QueryRow(ctx,
				`SELECT count(*) FROM task WHERE workspace_id = ANY($1)`, ids).Scan(&n)
		}))
		require.Equal(t, 0, n, "无上下文必须一行都看不见（策略不匹配是静默的）")

		var isNull bool
		require.NoError(t, e.app.Tx(ctx).QueryRow(ctx, `SELECT app.workspace_id() IS NULL`).Scan(&isNull))
		require.True(t, isNull)
	})

	t.Run("state3: WithTenant(A) 写 B 租户被 WITH CHECK 拒绝", func(t *testing.T) {
		err := pg.WithTenant(ctx, e.app, idA, func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx,
				`INSERT INTO task (workspace_id, number, title, created_by)
				 VALUES ($1, $2, 'cross-tenant write must fail', $3)`,
				e.wsB, e.seedCountB+1, e.userID)
			return err
		})
		require.Error(t, err)
		var pgErr *pgconn.PgError
		require.ErrorAs(t, err, &pgErr, "应是 PG 错误, got %v", err)
		require.Equal(t, rlsInsufficientPrivilege, pgErr.Code,
			"RLS WITH CHECK 违约应为 42501, got %s: %s", pgErr.Code, pgErr.Message)
		require.Contains(t, pgErr.Message, "row-level security")

		var n int
		require.NoError(t, e.admin.Pool().QueryRow(ctx,
			`SELECT count(*) FROM task WHERE workspace_id = $1`, e.wsB).Scan(&n))
		require.Equal(t, e.seedCountB, n)
	})

	t.Run("service 逃生口：管理员可见全部 / ploykit_app 经它仍 0 行", func(t *testing.T) {
		var viaAdmin int
		require.NoError(t, pg.WithService(ctx, e.admin, func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT count(*) FROM task WHERE workspace_id = ANY($1)`, ids).Scan(&viaAdmin)
		}))
		require.Greater(t, viaAdmin, 0, "BYPASSRLS 等效账号（超级用户）经 WithService 可见全部行")

		var viaApp int
		require.NoError(t, pg.WithService(ctx, e.app, func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT count(*) FROM task WHERE workspace_id = ANY($1)`, ids).Scan(&viaApp)
		}))
		require.Equal(t, 0, viaApp, "WithService 不是隐形后门：账号无 BYPASSRLS 就仍受 RLS 约束")
	})

	t.Run("并发不串号：同池并行 A/B 租户事务互不可见", func(t *testing.T) {

		want := map[uuid.UUID]int{}
		rows, err := e.admin.Pool().Query(ctx,
			`SELECT workspace_id, count(*) FROM task WHERE workspace_id = ANY($1) GROUP BY 1`, ids)
		require.NoError(t, err)
		for rows.Next() {
			var ws uuid.UUID
			var n int
			require.NoError(t, rows.Scan(&ws, &n))
			want[ws] = n
		}
		require.NoError(t, rows.Err())
		require.NotEmpty(t, want)

		const goroutines = 8
		var wg sync.WaitGroup
		errs := make(chan error, goroutines)
		for i := 0; i < goroutines; i++ {
			ws := e.wsA
			if i%2 == 1 {
				ws = e.wsB
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				id := pg.Identity{WorkspaceID: ws, UserID: e.userID}
				errs <- pg.WithTenant(ctx, e.app, id, func(ctx context.Context, tx pgx.Tx) error {
					got := map[uuid.UUID]int{}
					rows, err := tx.Query(ctx,
						`SELECT workspace_id, count(*) FROM task WHERE workspace_id = ANY($1) GROUP BY 1`, ids)
					if err != nil {
						return err
					}
					defer rows.Close()
					for rows.Next() {
						var w uuid.UUID
						var n int
						if err := rows.Scan(&w, &n); err != nil {
							return err
						}
						got[w] = n
					}
					if err := rows.Err(); err != nil {
						return err
					}
					if len(got) != 1 || got[ws] != want[ws] {
						return fmt.Errorf("租户 %s 应只见自身 %d 行, got %v（跨租户泄漏）", ws, want[ws], got)
					}
					return nil
				})
			}()
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			require.NoError(t, err)
		}
	})
}

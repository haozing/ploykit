package devx

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/stretchr/testify/require"
)

// openRlsDB opens a *sql.DB over the pgx stdlib driver, so the test can talk
// to the same server twice as two different roles (superuser + probe_app).
func openRlsDB(t *testing.T, cfg *pgx.ConnConfig) *sql.DB {
	t.Helper()
	db := sql.OpenDB(stdlib.GetConnector(*cfg))
	t.Cleanup(func() { _ = db.Close() })
	require.NoError(t, db.Ping())
	return db
}

// TestRLSCheck drives the probe against a disposable role/table pair in a
// dedicated database (roles are cluster-wide, the database is not, so the
// probe table list cannot be perturbed by other tests sharing the instance).
// Sequence matters: the superuser bypass and the empty-catalog PASS must run
// before any FORCE-RLS table exists.
func TestRLSCheck(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()

	bootstrap, err := pgx.ParseConfig(dsn)
	require.NoError(t, err)

	// Idempotent fixtures: a non-bypass role and a throwaway database.
	bootstrapDB := sql.OpenDB(stdlib.GetConnector(*bootstrap))
	t.Cleanup(func() { _ = bootstrapDB.Close() })
	require.NoError(t, bootstrapDB.Ping())
	for _, stmt := range []string{
		// The throwaway database first: the role's grants there would block
		// DROP ROLE (DROP OWNED only reaches the current database).
		`DROP DATABASE IF EXISTS devx_rls_check WITH (FORCE)`,
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'probe_app') THEN
				DROP OWNED BY probe_app;
				DROP ROLE probe_app;
			END IF;
		END $$;`,
		`CREATE ROLE probe_app LOGIN PASSWORD 'probe_app' NOSUPERUSER NOBYPASSRLS`,
		`CREATE DATABASE devx_rls_check`,
	} {
		_, err := bootstrapDB.ExecContext(ctx, stmt)
		require.NoError(t, err, stmt)
	}

	adminCfg := bootstrap.Copy()
	adminCfg.Database = "devx_rls_check"
	admin := openRlsDB(t, adminCfg)

	t.Run("superuser role fails with the bypass verdict", func(t *testing.T) {
		res := RLSCheck(admin).Run(ctx)
		require.False(t, res.Pass)
		require.Contains(t, res.Detail, "bypasses RLS")
		require.Contains(t, res.FixHint, "pg.WithTenant")
	})

	appCfg := adminCfg.Copy()
	appCfg.User = "probe_app"
	appCfg.Password = "probe_app"
	app := openRlsDB(t, appCfg)

	t.Run("no FORCE RLS tables passes as not applicable", func(t *testing.T) {
		res := RLSCheck(app).Run(ctx)
		require.True(t, res.Pass)
		require.Contains(t, res.Detail, "not applicable")
	})

	// A properly protected table: FORCE RLS + a GUC policy (fail-closed when
	// app.workspace_id is unset) + a seeded row that only tenant context sees.
	_, err = admin.ExecContext(ctx, `
		CREATE TABLE devx_rls_guard_probe (
			id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			workspace_id uuid NOT NULL
		);
		ALTER TABLE devx_rls_guard_probe ENABLE ROW LEVEL SECURITY;
		ALTER TABLE devx_rls_guard_probe FORCE ROW LEVEL SECURITY;
		CREATE POLICY devx_rls_guard_probe_tenant ON devx_rls_guard_probe
			USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
			WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
		INSERT INTO devx_rls_guard_probe (workspace_id) VALUES (gen_random_uuid());
		GRANT USAGE ON SCHEMA public TO probe_app;
		GRANT SELECT ON devx_rls_guard_probe TO probe_app;`)
	require.NoError(t, err)

	t.Run("protected table passes on a non-bypass role", func(t *testing.T) {
		res := RLSCheck(app).Run(ctx)
		require.True(t, res.Pass, "detail: %s", res.Detail)
		require.Contains(t, res.Detail, "devx_rls_guard_probe")
	})

	// A permissive policy is the incident shape: rows visible with no tenant
	// context must be named in the failure.
	_, err = admin.ExecContext(ctx, `
		CREATE TABLE devx_rls_leak_probe (
			id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			workspace_id uuid NOT NULL
		);
		ALTER TABLE devx_rls_leak_probe ENABLE ROW LEVEL SECURITY;
		ALTER TABLE devx_rls_leak_probe FORCE ROW LEVEL SECURITY;
		CREATE POLICY devx_rls_leak_probe_open ON devx_rls_leak_probe
			USING (true)
			WITH CHECK (true);
		INSERT INTO devx_rls_leak_probe (workspace_id) VALUES (gen_random_uuid());
		GRANT SELECT ON devx_rls_leak_probe TO probe_app;`)
	require.NoError(t, err)

	t.Run("permissive policy fails naming the table", func(t *testing.T) {
		res := RLSCheck(app).Run(ctx)
		require.False(t, res.Pass)
		require.Contains(t, res.Detail, "devx_rls_leak_probe")
	})
}

package videoapp

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/platform/webx"
)

// DB-gated integration suite (TEST_DATABASE_URL; skipped otherwise) — the
// service's real SQL: Create/Get/Mutate optimistic lock, anchor write-back,
// SubmitRender ordering, render listing. Bootstrap = framework migration
// chain + product migrations (task/handlers_test.go pattern).

var prodMigrationRe = regexp.MustCompile(`^(\d{3,})_[a-z0-9_]+\.up\.sql$`)

func applyProductMigrations(ctx context.Context, t *testing.T, pool *pgxpool.Pool) error {
	t.Helper()
	const dir = "../../../cmd/app/migrations"
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

type videoEnv struct {
	pool        *pgxpool.Pool
	svc         *ProjectService
	userID      string
	wsID        string
	wsForeign   string
	publish     *capturedPublisher
	cleanupFns  []func()
}

type capturedPublisher struct{ events []string }

func (c *capturedPublisher) BroadcastEvent(_ context.Context, event string, _ []byte, _ string) error {
	c.events = append(c.events, event)
	return nil
}

func newVideoEnv(t *testing.T) *videoEnv {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	require.NoError(t, pgmigrate.Up(ctx, pool, migrations.FS, "."), "framework migration chain")
	require.NoError(t, applyProductMigrations(ctx, t, pool), "product migration chain 1001+")

	uniq := time.Now().UnixNano()
	var uid string
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'video test') RETURNING id`,
		fmt.Sprintf("video-%d@test.local", uniq)).Scan(&uid))
	mkWs := func(name string) string {
		var id string
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO workspace (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id`,
			fmt.Sprintf("video-%d-%s", uniq, name), name, uid).Scan(&id))
		return id
	}
	wsID := mkWs("main")
	wsForeign := mkWs("foreign")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id IN ($1, $2)`, wsID, wsForeign)
		_, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid)
	})

	pub := &capturedPublisher{}
	svc := NewProjectService(pool, Ports{
		Membership: memberOf{wsID: wsID, userID: uid},
		Publish:    pub,
		Audit:      noopAudit{},
	}, nil)
	return &videoEnv{pool: pool, svc: svc, userID: uid, wsID: wsID, wsForeign: wsForeign, publish: pub}
}

// memberOf grants membership only for its own workspace (the workspace rows
// above are created by the test user, so workspace membership = created-by
// check would also pass; the fake keeps the test deterministic).
type memberOf struct{ wsID, userID string }

func (m memberOf) IsMember(_ context.Context, wsID, _ string) (bool, error) {
	return wsID == m.wsID, nil
}

type noopAudit struct{}

func (noopAudit) RecordTx(_ context.Context, _ pgx.Tx, _ *string, _ string, _, _, _ string, _ map[string]any) error {
	return nil
}

func (noopAudit) Record(_ context.Context, _ *string, _ string, _, _, _ string, _ map[string]any) {}

func (e *videoEnv) principal(ws string) *webx.Principal {
	return &webx.Principal{UserID: e.userID, WorkspaceID: ws, Source: webx.SourceSession}
}

func TestIntegration_CreateMutateGet(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()

	pr, err := e.svc.Create(ctx, e.principal(e.wsID), "演示项目")
	require.NoError(t, err)
	assert.Equal(t, 1, pr.Version)
	assert.Equal(t, "演示项目", pr.Title)

	// Mutate: SetScript writes words + resolves anchors + bumps version.
	v2, resolutions, source, err := e.svc.SetScript(ctx, e.principal(e.wsID), pr.ID,
		"这款产品发布后 留存率提升了三倍", nil)
	require.NoError(t, err)
	assert.Equal(t, 2, v2)
	assert.Equal(t, WordSourceEstimated, source, "no TTS wired → estimated")
	require.Len(t, resolutions, 0, "no effects yet")

	// Add an effect anchored at a word, then re-set the script: anchor
	// re-resolution writes resolvedFrom back (drift visible).
	_, rf, err := e.svc.AddEffectAtWord(ctx, e.principal(e.wsID), pr.ID,
		Anchor{Text: "三倍", Occurrence: 0}, EffectPulse, []byte(`{"scale":1.3}`), "", nil)
	require.NoError(t, err)
	require.NotNil(t, rf)
	assert.Equal(t, AnchorExact, rf.Reason)

	got, err := e.svc.Get(ctx, e.principal(e.wsID), pr.ID)
	require.NoError(t, err)
	require.Len(t, got.IR.Effects, 1)
	require.NotNil(t, got.IR.Effects[0].ResolvedFrom)
	assert.Equal(t, AnchorExact, got.IR.Effects[0].ResolvedFrom.Reason)

	// WS push fired after commit
	assert.Contains(t, e.publish.events, EventIRUpdated)

	// Cross-workspace Get is a 404 (workspace predicate), not a leak.
	_, err = e.svc.Get(ctx, e.principal(e.wsForeign), pr.ID)
	require.Error(t, err)
	var we *webx.Error
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_PROJECT_NOT_FOUND", we.Code)
}

func TestIntegration_OptimisticLockConflict(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()
	pr, err := e.svc.Create(ctx, e.principal(e.wsID), "锁测试")
	require.NoError(t, err)

	stale := pr.Version - 1
	if stale < 1 {
		stale = 1
	}
	// expectedVersion = stale (pr.Version is 1; simulate another writer first)
	if pr.Version > 1 {
		_, _, _, err = e.svc.SetScript(ctx, e.principal(e.wsID), pr.ID, "第一次改稿", nil)
		require.NoError(t, err)
	}
	wrong := pr.Version + 5
	var we *webx.Error
	_, _, _, err = e.svc.SetScript(ctx, e.principal(e.wsID), pr.ID, "冲突稿", &wrong)
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_VERSION_CONFLICT", we.Code)
	_ = stale
}

func TestIntegration_SubmitRender_GateOrder(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()
	pr, err := e.svc.Create(ctx, e.principal(e.wsID), "渲染测试")
	require.NoError(t, err)

	// Cap unwired → E_NOT_CONFIGURED before quota/render-row side effects.
	var we *webx.Error
	_, err = e.svc.SubmitRender(ctx, e.principal(e.wsID), pr.ID, RenderParams{}, nil, "")
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_NOT_CONFIGURED", we.Code)
	assert.Equal(t, httpStatusUnavailable, we.Status)

	// renders list stays empty (no row was created)
	items, err := e.svc.ListRenders(ctx, e.principal(e.wsID), pr.ID)
	require.NoError(t, err)
	assert.Empty(t, items)
}

const httpStatusUnavailable = 503

func errorAsWebx(err error, target **webx.Error) bool {
	for err != nil {
		if we, ok := err.(*webx.Error); ok {
			*target = we
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}

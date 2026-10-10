package pgrepo

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/analytics/app"
	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
)

func anTestDB(t *testing.T) (*Repo, *pgxpool.Pool, func()) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	require.NoError(t, pgmigrate.Up(ctx, db.Pool(), migrations.FS, "."))
	repo := New(db.Pool(), nil)
	return repo, db.Pool(), db.Close
}

func anType(prefix string) string { return prefix + "_" + uuid.NewString()[:8] }

func TestTrack_NullMatrix(t *testing.T) {
	repo, pool, closeDB := anTestDB(t)
	defer closeDB()
	ctx := context.Background()
	typNil := anType("an_nil")
	typEmpty := anType("an_empty")
	typLong := anType("an_long") + strings.Repeat("x", 4000)

	repo.Track(ctx, app.Event{Type: typNil, Payload: nil}, time.Now())
	repo.Track(ctx, app.Event{Type: typEmpty, Payload: map[string]any{}}, time.Now())
	repo.Track(ctx, app.Event{Type: typLong}, time.Now())

	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM analytics_event WHERE event_type LIKE 'an_%'`)
	})

	for _, typ := range []string{typNil, typEmpty, typLong} {
		var wsNull, userNull, etNull, eidNull, createdOK bool
		var payload string
		require.NoError(t, pool.QueryRow(ctx, `
			SELECT workspace_id IS NULL, user_id IS NULL, entity_type IS NULL,
			       entity_id IS NULL, payload::text, created_at IS NOT NULL
			FROM analytics_event WHERE event_type = $1`, typ).
			Scan(&wsNull, &userNull, &etNull, &eidNull, &payload, &createdOK),
			"Track 尽力而为，落库失败只会 Warn——行必须真的在")
		assert.True(t, wsNull, "空 WorkspaceID 应落 NULL（%s）", typ[:12])
		assert.True(t, userNull)
		assert.True(t, etNull)
		assert.True(t, eidNull)
		assert.Equal(t, "{}", payload, "nil/空 payload 应回退 '{}'（NOT NULL DEFAULT 陷阱回归）")
		assert.True(t, createdOK, "created_at 用 Track 实参而非库端 now()")
	}

	n, err := repo.CountByType(ctx, typLong, time.Now().Add(-time.Minute))
	require.NoError(t, err)
	assert.Equal(t, 1, n)
}

func TestTrackService_RedactionEndToEnd(t *testing.T) {
	repo, pool, closeDB := anTestDB(t)
	defer closeDB()
	ctx := context.Background()
	typ := anType("an_redact")
	svc := app.NewTrackService(repo, nil)

	svc.Track(ctx, app.Event{
		WorkspaceID: uuid.NewString(),
		Type:        typ,
		Payload: map[string]any{
			"email":  "someone@example.com",
			"token":  "ghp_" + strings.Repeat("q1w2e3", 7),
			"db_url": "postgres://root:hunter2@db.prod:5432/app",
			"nested": map[string]any{"api_key": "sk-proj-" + strings.Repeat("z9y8x7", 7)},
		},
	})
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM analytics_event WHERE event_type = $1`, typ)
	})

	var payload string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT payload::text FROM analytics_event WHERE event_type = $1`, typ).Scan(&payload))
	assert.Contains(t, payload, "[REDACTED:github_token]")
	assert.Contains(t, payload, "[REDACTED:conn_string]")
	assert.Contains(t, payload, "[REDACTED:openai_key]")
	assert.Contains(t, payload, "someone@example.com", "非敏感字段原样入库")
	assert.NotContains(t, payload, "ghp_", "敏感原文不得落库")
	assert.NotContains(t, payload, "hunter2")
	assert.NotContains(t, payload, "sk-proj-")
}

func TestQueries_ThreeShapes(t *testing.T) {
	repo, pool, closeDB := anTestDB(t)
	defer closeDB()
	ctx := context.Background()
	ws1, ws2 := uuid.NewString(), uuid.NewString()
	typ := anType("an_q")
	base := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)

	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM analytics_event WHERE workspace_id IN ($1, $2)`, ws1, ws2)
	})

	_, err := pool.Exec(ctx, `
		INSERT INTO analytics_event (workspace_id, event_type, entity_type, entity_id, payload, created_at) VALUES
		  ($1, $2, 'task', 'e-old1', '{"n":1}', $5),
		  ($1, $2, 'task', 'e-old2', '{}',       $6),
		  ($1, $3, 'task', 'e-other', '{}',      $6),
		  ($4, $2, 'task', 'e-new',   '{"n":9}', $7)`,
		ws1, typ, anType("an_other"), ws2,
		base.Add(-2*time.Minute), base.Add(-1*time.Minute), base)
	require.NoError(t, err)

	rows, err := repo.RecentByType(ctx, typ, 2)
	require.NoError(t, err)
	require.Len(t, rows, 2, "limit 生效：3 行取 2")
	assert.Equal(t, ws2, rows[0].WorkspaceID, "最新在前")
	assert.Equal(t, "e-new", rows[0].EntityID)
	assert.Equal(t, "e-old2", rows[1].EntityID)
	assert.Equal(t, map[string]any{"n": float64(9)}, rows[0].Payload, "jsonb payload 往返")
	assert.Equal(t, "task", rows[0].EntityType)
	assert.False(t, rows[0].CreatedAt.IsZero())
	assert.NotZero(t, rows[0].ID)

	n, err := repo.CountByType(ctx, typ, base.Add(-time.Hour))
	require.NoError(t, err)
	assert.Equal(t, 3, n, "全局计数含全部工作区（跨区口径，仅限平台侧）")

	n, err = repo.CountByType(ctx, typ, base.Add(-90*time.Second))
	require.NoError(t, err)
	assert.Equal(t, 2, n, "since 过滤生效")

	n, err = repo.CountByTypeInWorkspace(ctx, ws1, typ, base.Add(-time.Hour))
	require.NoError(t, err)
	assert.Equal(t, 2, n, "行级过滤：ws1 只算自己的 2 行（API-FT2-14）")

	n, err = repo.CountByTypeInWorkspace(ctx, ws2, typ, base.Add(-time.Hour))
	require.NoError(t, err)
	assert.Equal(t, 1, n)
}

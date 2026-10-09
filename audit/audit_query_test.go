package audit

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func newQueryEnv(t *testing.T) (*Recorder, *pgxpool.Pool, string, string, string, string) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	var uid string
	email := fmt.Sprintf("aqt-%s@test.local", uuid.NewString()[:12])
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'audit query test') RETURNING id`, email).Scan(&uid))
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid) })

	mkWs := func(name string) string {
		var id string
		slug := "aqt-" + uuid.NewString()[:8]
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO workspace (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id`, slug, name, uid).Scan(&id))
		return id
	}
	wsA, wsB := mkWs("AQ-A"), mkWs("AQ-B")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM audit_event WHERE workspace_id IN ($1, $2)`, wsA, wsB)
		_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id IN ($1, $2)`, wsA, wsB)
	})
	return NewRecorder(pool, nil), pool, wsA, wsB, uid, email
}

func seedQueryEvents(t *testing.T, rec *Recorder, pool *pgxpool.Pool, wsA, wsB, uid, email string) {
	t.Helper()
	ctx := context.Background()
	ws := func(s string) *string { return &s }

	rec.Record(WithRequestID(ctx, "req-aqt-1"), ws(wsA),
		&webx.Principal{UserID: uid, Email: email, Source: webx.SourceSession, WorkspaceID: wsA, Role: "owner"},
		"task.created", "task", "t-1", map[string]any{"title": "hello"})

	rec.Record(ctx, ws(wsA), nil, "workspace.provisioned", "workspace", wsA, nil)

	rec.Record(WithRequestID(ctx, "req-aqt-3"), ws(wsA),
		&webx.Principal{UserID: uid, Email: email, Source: webx.SourcePAT, WorkspaceID: wsA, Role: "owner"},
		"user.login", "user", "", map[string]any{"note": "hello, \"world\"\nline2"})

	rec.Record(ctx, ws(wsB),
		&webx.Principal{UserID: uid, Email: email, Source: webx.SourceSession, WorkspaceID: wsB, Role: "owner"},
		"task.created", "task", "t-9", nil)

	_, err := pool.Exec(ctx, `
		INSERT INTO audit_event (workspace_id, actor_type, actor_id, actor_snapshot, action, resource_type, resource_id, metadata, created_at)
		VALUES ($1, 'user', $2, $3::jsonb, 'plan.changed', 'subscription', 'sub-1', '{"k":"v"}'::jsonb, now() - interval '48 hours')`,
		wsA, uid, fmt.Sprintf(`{"email":%q,"role":"owner"}`, email))
	require.NoError(t, err)

	var n int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_event WHERE workspace_id IN ($1, $2)`, wsA, wsB).Scan(&n))
	require.Equal(t, 5, n, "seeding must produce 5 events")
}

func actions(items []map[string]any) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, it["action"].(string))
	}
	return out
}

func TestRecorderQuery_FilterMatrix(t *testing.T) {
	rec, pool, wsA, wsB, uid, email := newQueryEnv(t)
	seedQueryEvents(t, rec, pool, wsA, wsB, uid, email)
	ctx := context.Background()
	at := func(s string) *time.Time {
		tt, err := time.Parse(time.RFC3339, s)
		require.NoError(t, err)
		return &tt
	}

	recent := at(time.Now().UTC().Add(-time.Minute).Format(time.RFC3339))
	twoDaysAgo := at(time.Now().UTC().Add(-96 * time.Hour).Format(time.RFC3339))
	oneDayAgo := at(time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339))

	cases := []struct {
		name      string
		q         ListQuery
		wantTotal int
		wantActs  []string
	}{
		{
			name:      "仅工作区",
			q:         ListQuery{WorkspaceID: wsA},
			wantTotal: 4,
			wantActs:  []string{"user.login", "workspace.provisioned", "task.created", "plan.changed"},
		},
		{
			name:      "action 过滤",
			q:         ListQuery{WorkspaceID: wsA, Action: "task.created"},
			wantTotal: 1,
			wantActs:  []string{"task.created"},
		},
		{
			name:      "actor_id 过滤（系统事件无 actor）",
			q:         ListQuery{WorkspaceID: wsA, ActorID: uid},
			wantTotal: 3,
			wantActs:  []string{"user.login", "task.created", "plan.changed"},
		},
		{
			name:      "resource_type 过滤",
			q:         ListQuery{WorkspaceID: wsA, ResourceType: "user"},
			wantTotal: 1,
			wantActs:  []string{"user.login"},
		},
		{
			name:      "时间窗 [From,To) 含 48h 旧事件、不含新事件",
			q:         ListQuery{WorkspaceID: wsA, From: twoDaysAgo, To: oneDayAgo},
			wantTotal: 1,
			wantActs:  []string{"plan.changed"},
		},
		{
			name:      "From 起较新、旧事件被排除",
			q:         ListQuery{WorkspaceID: wsA, From: recent},
			wantTotal: 3,
			wantActs:  []string{"user.login", "workspace.provisioned", "task.created"},
		},
		{
			name:      "组合过滤",
			q:         ListQuery{WorkspaceID: wsA, ActorID: uid, ResourceType: "task"},
			wantTotal: 1,
			wantActs:  []string{"task.created"},
		},
		{
			name:      "工作区隔离（wsB 只有 1 条）",
			q:         ListQuery{WorkspaceID: wsB},
			wantTotal: 1,
			wantActs:  []string{"task.created"},
		},
		{
			name:      "limit/offset 分页不改 total",
			q:         ListQuery{WorkspaceID: wsA, Limit: 2},
			wantTotal: 4,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			items, total, err := rec.Query(ctx, tc.q)
			require.NoError(t, err)
			assert.Equal(t, tc.wantTotal, total)
			if tc.wantActs != nil {
				assert.Equal(t, tc.wantActs, actions(items))
			} else {
				assert.Len(t, items, min(tc.q.Limit, tc.wantTotal))
			}
		})
	}

	t.Run("空工作区 = 全量（跨 A/B，共享库防御式断言）", func(t *testing.T) {
		items, total, err := rec.Query(ctx, ListQuery{Action: "task.created"})
		require.NoError(t, err)
		assert.GreaterOrEqual(t, total, 2, "至少包含 A/B 两工作区各一条")
		rids := map[string]bool{}
		for _, it := range items {
			assert.Equal(t, "task.created", it["action"])
			if v, ok := it["resource_id"].(string); ok {
				rids[v] = true
			}
		}
		assert.True(t, rids["t-1"] && rids["t-9"], "两条种子事件都命中")
	})

	t.Run("分页 offset 翻页", func(t *testing.T) {
		p1, total, err := rec.Query(ctx, ListQuery{WorkspaceID: wsA, Limit: 2, Offset: 0})
		require.NoError(t, err)
		assert.Equal(t, 4, total)
		assert.Equal(t, []string{"user.login", "workspace.provisioned"}, actions(p1))
		p2, _, err := rec.Query(ctx, ListQuery{WorkspaceID: wsA, Limit: 2, Offset: 2})
		require.NoError(t, err)
		assert.Equal(t, []string{"task.created", "plan.changed"}, actions(p2))
		p3, _, err := rec.Query(ctx, ListQuery{WorkspaceID: wsA, Limit: 2, Offset: 4})
		require.NoError(t, err)
		assert.Empty(t, p3, "offset 越界返回空页而非错误")
	})

	t.Run("items 形状与 List 一致（id/workspace_id 为 JSON 友好字符串）", func(t *testing.T) {
		items, _, err := rec.Query(ctx, ListQuery{WorkspaceID: wsA, Action: "user.login"})
		require.NoError(t, err)
		require.Len(t, items, 1)
		it := items[0]
		for _, k := range []string{"id", "workspace_id", "actor_type", "actor_id", "actor_snapshot", "action",
			"resource_type", "resource_id", "metadata", "created_at"} {
			assert.Contains(t, it, k)
		}
		id, ok := it["id"].(string)
		require.True(t, ok, "id 应为字符串（uuid::text，JSON 可读）")
		assert.NotEmpty(t, id)
		assert.Equal(t, wsA, it["workspace_id"])
		assert.Equal(t, "pat", it["actor_type"])
		snap, ok := it["actor_snapshot"].(map[string]any)
		require.True(t, ok, "actor_snapshot 应为对象")
		assert.Equal(t, email, snap["email"])
	})
}

func TestRecorderQuery_LimitDefaults(t *testing.T) {
	rec, pool, wsA, wsB, uid, email := newQueryEnv(t)
	seedQueryEvents(t, rec, pool, wsA, wsB, uid, email)

	t.Run("Limit 0 → 缺省 100", func(t *testing.T) {
		items, total, err := rec.Query(context.Background(), ListQuery{WorkspaceID: wsA})
		require.NoError(t, err)
		assert.Equal(t, 4, total)
		assert.Len(t, items, 4, "4 < 100，全部返回")
	})
	t.Run("Limit 越界钳制", func(t *testing.T) {
		assert.Equal(t, 100, normalizePage(0, 100, 100, 500).limit)
		assert.Equal(t, 100, normalizePage(-3, 100, 100, 500).limit)
		assert.Equal(t, 100, normalizePage(100, 100, 100, 500).limit)
		assert.Equal(t, 500, normalizePage(9999, 100, 100, 500).limit)
		assert.Equal(t, 5000, normalizePage(0, 5000, 5000, 5000).limit)
		assert.Equal(t, 5000, normalizePage(6000, 5000, 5000, 5000).limit)
		assert.Equal(t, 0, normalizePage(100, -8, 100, 500).offset)
		assert.Equal(t, 40, normalizePage(10, 40, 100, 500).offset)
	})
}

func TestRecorderExportCSV(t *testing.T) {
	rec, pool, wsA, wsB, uid, email := newQueryEnv(t)
	seedQueryEvents(t, rec, pool, wsA, wsB, uid, email)
	ctx := context.Background()

	t.Run("表头 + 过滤 + email 提取 + 转义", func(t *testing.T) {
		var buf bytes.Buffer
		require.NoError(t, rec.ExportCSV(ctx, ListQuery{WorkspaceID: wsA, Action: "user.login"}, &buf))

		lines := strings.SplitN(strings.TrimSuffix(buf.String(), "\n"), "\n", 2)
		require.Len(t, lines, 2, "表头 + 单行数据")
		assert.Equal(t,
			"created_at,actor_type,actor_id,actor_email,action,resource_type,resource_id,request_id,metadata",
			lines[0])

		rows, err := csv.NewReader(strings.NewReader(buf.String())).ReadAll()
		require.NoError(t, err)
		require.Len(t, rows, 2)
		row := rows[1]
		assert.Equal(t, "pat", row[1])
		assert.Equal(t, uid, row[2])
		assert.Equal(t, email, row[3], "actor_email 取自 actor_snapshot->>'email'")
		assert.Equal(t, "user.login", row[4])
		assert.Equal(t, "user", row[5])
		assert.Empty(t, row[6], "resource_id 为空")
		assert.Equal(t, "req-aqt-3", row[7], "request_id 透传")
		assert.Contains(t, row[8], `hello, \"world\"`)
		assert.Contains(t, row[8], `\nline2`, "jsonb 文本形态保留转义序列；字段含逗号/引号由 CSV 引号转义兜住")
		_, err = time.Parse(time.RFC3339Nano, row[0])
		assert.NoError(t, err, "created_at 为 RFC3339 可解析")
	})

	t.Run("系统事件 actor_email 为空、metadata 原样 jsonb 字符串", func(t *testing.T) {
		var buf bytes.Buffer
		require.NoError(t, rec.ExportCSV(ctx, ListQuery{WorkspaceID: wsA, Action: "workspace.provisioned"}, &buf))
		rows, err := csv.NewReader(strings.NewReader(buf.String())).ReadAll()
		require.NoError(t, err)
		require.Len(t, rows, 2)
		assert.Equal(t, "system", rows[1][1])
		assert.Empty(t, rows[1][3])
		assert.Equal(t, "{}", rows[1][8])
	})

	t.Run("48h 旧事件（直插快照 email）与导出上限缺省", func(t *testing.T) {
		var buf bytes.Buffer
		require.NoError(t, rec.ExportCSV(ctx, ListQuery{WorkspaceID: wsA, ResourceType: "subscription"}, &buf))
		rows, err := csv.NewReader(strings.NewReader(buf.String())).ReadAll()
		require.NoError(t, err)
		require.Len(t, rows, 2)
		assert.Equal(t, email, rows[1][3])
		assert.Equal(t, `{"k": "v"}`, rows[1][8], "metadata 以 jsonb 原样字符串输出（含键后空格）")
	})

	t.Run("无匹配导出仅表头", func(t *testing.T) {
		var buf bytes.Buffer
		require.NoError(t, rec.ExportCSV(ctx, ListQuery{WorkspaceID: wsA, Action: "nope.none"}, &buf))
		assert.Equal(t,
			"created_at,actor_type,actor_id,actor_email,action,resource_type,resource_id,request_id,metadata\n",
			buf.String())
	})

	t.Run("公式注入转义（AD3）：整格租户可控字段以 ' 前置", func(t *testing.T) {

		rec.Record(ctx, &wsA,
			&webx.Principal{UserID: "u-evil", Email: `=HYPERLINK("http://evil","click")`, Source: webx.SourceSession},
			"ad3.payload", "task", `=SUM(1,9)`, map[string]any{"name": `+cmd|'/c calc'!A1`})

		var buf bytes.Buffer
		require.NoError(t, rec.ExportCSV(ctx, ListQuery{WorkspaceID: wsA, Action: "ad3.payload"}, &buf))
		rows, err := csv.NewReader(strings.NewReader(buf.String())).ReadAll()
		require.NoError(t, err)
		require.Len(t, rows, 2, "表头 + 单行")
		row := rows[1]
		assert.Equal(t, `'=HYPERLINK("http://evil","click")`, row[3], "actor_email 危险前缀转义")
		assert.Equal(t, "'=SUM(1,9)", row[6], "resource_id 危险前缀转义")
		assert.Contains(t, row[8], `+cmd`, "metadata 内负载原样保留（格值以 { 开头，非公式）")
	})
}

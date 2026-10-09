package audithttp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/audit"
	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
)

func withPrincipal(p *webx.Principal) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if p == nil {
				next.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r.WithContext(webx.WithPrincipal(r.Context(), p)))
		})
	}
}

func do(t *testing.T, mux *http.ServeMux, p *webx.Principal, path string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, path, nil)
	if p != nil {
		r = r.WithContext(webx.WithPrincipal(r.Context(), p))
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestMount_Auth(t *testing.T) {
	owner := &webx.Principal{UserID: "u1", WorkspaceID: "ws-1", Role: "owner"}
	member := &webx.Principal{UserID: "u2", WorkspaceID: "ws-1", Role: "member"}

	t.Run("未认证 401", func(t *testing.T) {
		mux := http.NewServeMux()
		Mount(mux, Deps{WsMW: withPrincipal(nil), Authz: authz.New(nil, nil)})
		assert.Equal(t, http.StatusUnauthorized, do(t, mux, nil, "/api/audit").Code)
		assert.Equal(t, http.StatusUnauthorized, do(t, mux, nil, "/api/audit/export.csv").Code)
	})
	t.Run("无工作区上下文 401", func(t *testing.T) {
		mux := http.NewServeMux()
		Mount(mux, Deps{WsMW: withPrincipal(&webx.Principal{UserID: "u3"}), Authz: authz.New(nil, nil)})
		assert.Equal(t, http.StatusUnauthorized, do(t, mux, &webx.Principal{UserID: "u3"}, "/api/audit").Code)
	})
	t.Run("member 无 audit:read 403（authz 在场）", func(t *testing.T) {
		mux := http.NewServeMux()
		Mount(mux, Deps{WsMW: withPrincipal(member), Authz: authz.New(nil, nil)})
		w := do(t, mux, member, "/api/audit")
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "E_FORBIDDEN")
	})
	t.Run("无 Authz 时退 owner/admin：owner 过、outsider 拒", func(t *testing.T) {
		mux := http.NewServeMux()
		Mount(mux, Deps{WsMW: withPrincipal(owner)})
		w := do(t, mux, owner, "/api/audit?from=bad")
		assert.Equal(t, http.StatusBadRequest, w.Code, "owner 过鉴权，落在参数校验 400（无 DB 也能验证）")

		outsider := &webx.Principal{UserID: "u4", WorkspaceID: "ws-1", Role: "outsider"}
		mux2 := http.NewServeMux()
		Mount(mux2, Deps{WsMW: withPrincipal(outsider)})
		assert.Equal(t, http.StatusForbidden, do(t, mux2, outsider, "/api/audit").Code)
	})
}

func TestMount_ParamValidation(t *testing.T) {
	owner := &webx.Principal{UserID: "u1", WorkspaceID: "ws-1", Role: "owner"}
	mux := http.NewServeMux()
	Mount(mux, Deps{WsMW: withPrincipal(owner)})

	cases := []string{
		"/api/audit?from=2026-10-05",
		"/api/audit?to=not-a-time",
		"/api/audit?from=2026-10-05T00:00:00%2B08:00&to=bad",
		"/api/audit?limit=abc",
		"/api/audit?offset=-x",
		"/api/audit/export.csv?from=bad",
		"/api/audit/export.csv?limit=1.5",
	}
	for _, path := range cases {
		w := do(t, mux, owner, path)
		assert.Equal(t, http.StatusBadRequest, w.Code, path)
		assert.Contains(t, w.Body.String(), "E_VALIDATION", path)
	}
}

func TestMount_Integration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	var uid string
	email := fmt.Sprintf("aht-%s@test.local", uuid.NewString()[:12])
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'audit http test') RETURNING id`, email).Scan(&uid))
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid) })
	var wsID string
	slug := "aht-" + uuid.NewString()[:8]
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspace (slug, name, created_by) VALUES ($1, 'Audit Http', $2) RETURNING id`, slug, uid).Scan(&wsID))
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM audit_event WHERE workspace_id = $1`, wsID)
		_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsID)
	})

	rec := audit.NewRecorder(pool, nil)
	ws := &wsID
	rec.Record(ctx, ws, &webx.Principal{UserID: uid, Email: email, Source: webx.SourceSession, WorkspaceID: wsID, Role: "owner"},
		"task.created", "task", "t-1", nil)
	rec.Record(ctx, ws, nil, "workspace.provisioned", "workspace", wsID, nil)

	owner := &webx.Principal{UserID: uid, WorkspaceID: wsID, Role: "owner"}
	mux := http.NewServeMux()
	Mount(mux, Deps{Rec: rec, WsMW: withPrincipal(owner), Authz: authz.New(nil, nil)})

	t.Run("列表 items/total 与过滤", func(t *testing.T) {
		w := do(t, mux, owner, "/api/audit")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var body struct {
			Items []map[string]any `json:"items"`
			Total int              `json:"total"`
		}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		assert.Equal(t, 2, body.Total)
		require.Len(t, body.Items, 2)
		assert.Equal(t, "workspace.provisioned", body.Items[0]["action"], "created_at 倒序：后写入的在前")

		w = do(t, mux, owner, "/api/audit?action=workspace.provisioned")
		require.Equal(t, http.StatusOK, w.Code)
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		assert.Equal(t, 1, body.Total)
		assert.Equal(t, wsID, body.Items[0]["workspace_id"])

		w = do(t, mux, owner, "/api/audit?action=none.none")
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		assert.Equal(t, 0, body.Total)
		assert.Empty(t, body.Items)
	})

	t.Run("RFC3339 时间参数过滤", func(t *testing.T) {
		to := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
		w := do(t, mux, owner, "/api/audit?from="+strings.Replace(time.Now().UTC().Add(-time.Minute).Format(time.RFC3339), "+", "%2B", -1)+"&to="+strings.Replace(to, "+", "%2B", -1))
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var body struct {
			Total int `json:"total"`
		}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		assert.Equal(t, 2, body.Total, "两条种子事件都落在近 1 分钟窗口内")
	})

	t.Run("export.csv 契约", func(t *testing.T) {
		w := do(t, mux, owner, "/api/audit/export.csv?action=task.created")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Equal(t, "text/csv; charset=utf-8", w.Header().Get("Content-Type"))
		assert.Regexp(t, `attachment; filename="audit-`+wsID+`-\d{8}\.csv"`,
			w.Header().Get("Content-Disposition"))
		lines := strings.Split(strings.TrimSuffix(w.Body.String(), "\n"), "\n")
		require.Len(t, lines, 2)
		assert.Equal(t,
			"created_at,actor_type,actor_id,actor_email,action,resource_type,resource_id,request_id,metadata",
			lines[0])
		assert.Contains(t, lines[1], "task.created")
		assert.Contains(t, lines[1], email)
	})
}

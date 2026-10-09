package quotahttp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/quota"
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

func do(t *testing.T, mux *http.ServeMux, p *webx.Principal) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/usage", nil)
	if p != nil {
		r = r.WithContext(webx.WithPrincipal(r.Context(), p))
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestUsageRoute_Auth(t *testing.T) {
	newMux := func(wsMW func(http.Handler) http.Handler, authzOn bool) *http.ServeMux {
		var a *authz.Authorizer
		if authzOn {
			a = authz.New(nil, nil)
		}
		mux := http.NewServeMux()
		Mount(mux, Deps{Svc: quota.NewService(nil), WsMW: wsMW, Authz: a})
		return mux
	}

	t.Run("未认证 401", func(t *testing.T) {
		w := do(t, newMux(withPrincipal(nil), true), nil)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
		assert.Contains(t, w.Body.String(), "E_UNAUTHENTICATED")
	})
	t.Run("无工作区上下文 401", func(t *testing.T) {
		mux := newMux(withPrincipal(&webx.Principal{UserID: "alice"}), true)
		w := do(t, mux, &webx.Principal{UserID: "alice"})
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
	t.Run("角色非三档且无权限点 403", func(t *testing.T) {
		mux := newMux(withPrincipal(&webx.Principal{UserID: "eve", WorkspaceID: "ws-1", Role: "outsider"}), true)
		w := do(t, mux, &webx.Principal{UserID: "eve", WorkspaceID: "ws-1", Role: "outsider"})
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "E_FORBIDDEN")
	})
}

func TestUsageRoute_Integration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	var uid string
	email := fmt.Sprintf("ws3u-%s@test.local", uuid.NewString()[:12])
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'ws3 usage') RETURNING id`, email).Scan(&uid))
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid) })
	var wsID string
	slug := "ws3u-" + uuid.NewString()[:8]
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspace (slug, name, created_by) VALUES ($1, 'WS3 Usage', $2) RETURNING id`, slug, uid).Scan(&wsID))
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsID) })

	period := quota.Period(time.Now().UTC())
	_, err = pool.Exec(ctx,
		`INSERT INTO quota_counter (workspace_id, period, counter_key, used) VALUES ($1, $2, 'tasks_monthly', 40)`,
		wsID, period)
	require.NoError(t, err)

	mux := http.NewServeMux()
	Mount(mux, Deps{
		Svc:   quota.NewService(pool),
		WsMW:  withPrincipal(&webx.Principal{UserID: uid, WorkspaceID: wsID, Role: "member"}),
		Authz: authz.New(nil, nil),
	})

	w := do(t, mux, &webx.Principal{UserID: uid, WorkspaceID: wsID, Role: "member"})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var body struct {
		WorkspaceID string         `json:"workspace_id"`
		PlanCode    string         `json:"plan_code"`
		Period      string         `json:"period"`
		Items       []quota.Status `json:"items"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Equal(t, wsID, body.WorkspaceID)
	assert.Equal(t, "free", body.PlanCode)
	assert.Equal(t, period, body.Period)
	require.Len(t, body.Items, 2, "free 档两个维度（tasks_monthly/workspaces），key 排序稳定")
	assert.Equal(t, quota.Status{Key: "tasks_monthly", Limit: 50, Used: 40, Granted: 0, Period: period}, body.Items[0])
	assert.Equal(t, quota.Status{Key: "workspaces", Limit: 1, Used: 0, Granted: 0, Period: period}, body.Items[1])
}

func TestUsageRoute_AccountScopedDims(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	var uid string
	email := fmt.Sprintf("ws3a-%s@test.local", uuid.NewString()[:12])
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'ws3 acct') RETURNING id`, email).Scan(&uid))
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid) })

	var wsIDs [2]string
	for i, nm := range []string{"acct-a", "acct-b"} {
		slug := "ws3a-" + uuid.NewString()[:8]
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO workspace (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id`, slug, nm, uid).Scan(&wsIDs[i]))
		_, err = pool.Exec(ctx,
			`INSERT INTO member (workspace_id, user_id, role, created_by) VALUES ($1, $2, 'owner', $2)`, wsIDs[i], uid)
		require.NoError(t, err)
	}
	t.Cleanup(func() {
		for _, id := range wsIDs {
			_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, id)
		}
	})

	period := quota.Period(time.Now().UTC())
	_, err = pool.Exec(ctx,
		`INSERT INTO quota_counter (workspace_id, period, counter_key, used) VALUES ($1, $2, 'workspaces', 1)`,
		wsIDs[0], period)
	require.NoError(t, err)

	countUserWorkspaces := func(ctx context.Context, userID string) (int64, error) {
		var n int64
		err := pool.QueryRow(ctx, `
			SELECT count(DISTINCT m.workspace_id) FROM member m
			JOIN workspace w ON w.id = m.workspace_id
			WHERE m.user_id = $1 AND m.removed_at IS NULL`, userID).Scan(&n)
		return n, err
	}

	mux := http.NewServeMux()
	Mount(mux, Deps{
		Svc:  quota.NewService(pool),
		WsMW: withPrincipal(&webx.Principal{UserID: uid, WorkspaceID: wsIDs[0], Role: "member"}),
		AccountScopedDims: map[string]AccountUsageFunc{
			"workspaces": countUserWorkspaces,
		},
	})

	w := do(t, mux, &webx.Principal{UserID: uid, WorkspaceID: wsIDs[0], Role: "member"})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var body struct {
		Items []quota.Status `json:"items"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	byKey := map[string]quota.Status{}
	for _, it := range body.Items {
		byKey[it.Key] = it
	}

	assert.Equal(t, int64(2), byKey["workspaces"].Used, "账号实时计数应压过工作区桶历史行")
	assert.Equal(t, int64(1), byKey["workspaces"].Limit)

	assert.Equal(t, int64(0), byKey["tasks_monthly"].Used)
}

package http

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
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/billing/adapters/pgrepo"
	billworkers "github.com/haozing/ploykit/billing/adapters/workers"
	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/platform/webx"
)

func withPrincipal(p *webx.Principal) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(webx.WithPrincipal(r.Context(), p)))
		})
	}
}

func doPreview(t *testing.T, mux *http.ServeMux, p *webx.Principal) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/billing/usage-preview", nil)
	if p != nil {
		r = r.WithContext(webx.WithPrincipal(r.Context(), p))
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func previewMux(wsMW func(http.Handler) http.Handler, a *authz.Authorizer, usage billworkers.UsageReader, svc *app.BillingService) *http.ServeMux {
	mux := http.NewServeMux()
	Mount(mux, Deps{Svc: svc, WsMW: wsMW, Authz: a, Usage: usage})
	return mux
}

func TestUsagePreviewRoute_Auth(t *testing.T) {
	t.Run("未认证 401", func(t *testing.T) {
		w := doPreview(t, previewMux(withPrincipal(nil), authz.New(nil, nil), nil, nil), nil)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
	t.Run("无工作区上下文（无角色）→ guard 先拦 403", func(t *testing.T) {

		mux := previewMux(withPrincipal(&webx.Principal{UserID: "alice"}), authz.New(nil, nil), nil, nil)
		w := doPreview(t, mux, &webx.Principal{UserID: "alice"})
		assert.Equal(t, http.StatusForbidden, w.Code)
	})
	t.Run("角色非内置三档且无权限点 403", func(t *testing.T) {
		outsider := &webx.Principal{UserID: "eve", WorkspaceID: "ws-1", Role: "outsider"}
		mux := previewMux(withPrincipal(outsider), authz.New(nil, nil), nil, nil)
		w := doPreview(t, mux, outsider)
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "E_FORBIDDEN")
	})
}

func TestUsagePreviewRoute_Integration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	require.NoError(t, pgmigrate.Up(ctx, db.Pool(), migrations.FS, "."))
	t.Cleanup(func() { db.Close() })
	pool := db.Pool()
	repo := pgrepo.New(pool)

	planCode := "meter_pv"
	_, err = pool.Exec(ctx, `
		INSERT INTO plan (code, name, limits, sort_no) VALUES
		($1, '预估测试档', '{"metered_tasks_monthly_unit_cents":10,"metered_tasks_monthly_included":100,
			"metered_api_calls_unit_cents":2,"metered_api_calls_included":1000}'::jsonb, 92)`, planCode)
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM plan WHERE code = $1`, planCode) })

	uid := uuid.NewString()
	_, err = pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`,
		uid, fmt.Sprintf("pv-%s@test.dev", uid[:12]))
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid) })
	var wsID string
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO workspace (slug, name, plan_code, created_by) VALUES ($1, '预估测试', $2, $3) RETURNING id`,
		"pv-"+uid[:8], planCode, uid).Scan(&wsID))
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsID) })

	usage := billworkers.UsageReader(func(_ context.Context, ws, key, period string) (int64, int64, error) {
		assert.Equal(t, wsID, ws)
		assert.Equal(t, time.Now().UTC().Format("2006-01"), period, "预估取当期实时")
		if key == "tasks_monthly" {
			return 120, 0, nil
		}
		return 400, 0, nil
	})
	svc := app.NewBillingService(repo, app.NewChannelRegistry(), app.Config{}, app.BillingHooks{}, nil,
		func() time.Time { return time.Now().UTC() }, nil)

	member := &webx.Principal{UserID: uid, WorkspaceID: wsID, Role: "member"}
	mux := previewMux(withPrincipal(member), authz.New(nil, nil), usage, svc)

	w := doPreview(t, mux, member)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var body app.UsagePreview
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Equal(t, time.Now().UTC().Format("2006-01"), body.Period)
	require.Len(t, body.Items, 2, "计量维度全列（含未超额）")
	assert.Equal(t, app.UsagePreviewItem{Dim: "api_calls", Used: 400, Included: 1000, UnitCents: 2, ProjectedOverageCents: 0}, body.Items[0])
	assert.Equal(t, app.UsagePreviewItem{Dim: "tasks_monthly", Used: 120, Included: 100, UnitCents: 10, ProjectedOverageCents: 200}, body.Items[1])
	assert.Equal(t, int64(200), body.ProjectedTotalCents)
}

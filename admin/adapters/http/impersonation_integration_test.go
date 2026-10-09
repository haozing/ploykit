package http

import (
	"context"
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

	adminpg "github.com/haozing/ploykit/admin/adapters/pgrepo"
	"github.com/haozing/ploykit/admin/app"
	auditrec "github.com/haozing/ploykit/audit"
	identitypg "github.com/haozing/ploykit/identity/adapters/pgrepo"
	"github.com/haozing/ploykit/migrations"
	pgm "github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/platform/webx"
)

func TestImpersonate_Integration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	_, err = pgm.New(pool, migrations.FS, ".").Up(ctx, 0)
	require.NoError(t, err, "迁移自举到最新")

	suffix := uuid.NewString()[:12]
	var adminID, targetID string
	adminEmail := fmt.Sprintf("imp-admin-%s@test.local", suffix)
	targetEmail := fmt.Sprintf("imp-target-%s@test.local", suffix)
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name, is_platform_admin) VALUES ($1, 'imp admin', true) RETURNING id`,
		adminEmail).Scan(&adminID))
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'imp target') RETURNING id`,
		targetEmail).Scan(&targetID))
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM audit_event WHERE actor_id = $1 AND action = 'admin.impersonate'`, adminID)
		_, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id IN ($1, $2)`, adminID, targetID)
	})

	authCfg := webx.DefaultAuthConfig()
	mux := http.NewServeMux()
	Mount(mux, Deps{
		Svc:      app.NewAdminService(adminpg.New(pool), func() time.Time { return time.Now().UTC() }),
		Rec:      auditrec.NewRecorder(pool, nil),
		Sessions: identitypg.New(pool, identitypg.Config{SessionTTL: authCfg.SessionTTL, AbsoluteTTL: authCfg.AbsoluteTTL}),
		AuthCfg:  &authCfg,
	})

	r := httptest.NewRequest(http.MethodPost, "/api/admin/users/"+targetID+"/impersonate", nil)
	r = r.WithContext(webx.WithPrincipal(r.Context(), &webx.Principal{
		UserID: adminID, Email: adminEmail, IsPlatformAdmin: true, Source: webx.SourceSession,
	}))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	ck := w.Header().Get("Set-Cookie")
	assert.Contains(t, ck, authCfg.CookieName+"=")
	token := ck[len(authCfg.CookieName)+1:]
	if i := indexByte(token, ';'); i >= 0 {
		token = token[:i]
	}
	sessionsRepo := identitypg.New(pool, identitypg.Config{SessionTTL: authCfg.SessionTTL, AbsoluteTTL: authCfg.AbsoluteTTL})
	principal, err := sessionsRepo.VerifySession(ctx, token, time.Now().UTC())
	require.NoError(t, err)
	require.NotNil(t, principal)
	assert.Equal(t, targetID, principal.UserID, "新会话解析为目标用户")

	assert.Equal(t, adminID, principal.ImpersonatedBy, "模拟会话必须带发起管理员标记")

	promoted := *principal
	promoted.IsPlatformAdmin = true
	r2 := httptest.NewRequest(http.MethodPost, "/api/admin/users/"+adminID+"/impersonate", nil)
	r2 = r2.WithContext(webx.WithPrincipal(r2.Context(), &promoted))
	w2 := httptest.NewRecorder()
	mux.ServeHTTP(w2, r2)
	assert.Equal(t, http.StatusForbidden, w2.Code, "模拟会话再模拟必须 403（防链式）: %s", w2.Body.String())

	entries, total, err := adminpg.New(pool).QueryAudit(ctx, auditrec.ListQuery{ActorID: adminID, Action: "admin.impersonate"})
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Len(t, entries, 1)
	e := entries[0]
	assert.Equal(t, "user", e.ResourceType)
	assert.Equal(t, targetID, e.ResourceID)
	assert.Equal(t, adminEmail, e.ActorSnapshot["email"], "actor 快照取管理员")
	assert.Equal(t, targetEmail, e.Metadata["target_email"])
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

package http

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/audit"
	"github.com/haozing/ploykit/platform/webx"
)

type extRepo struct {
	app.Repo

	gotQuery  audit.ListQuery
	gotExtIDs []string
	gotPrefix string

	prefixIDs []string
	entries   []app.AuditEntry
	total     int

	exportRows  [][]string
	exportTrunc bool

	users   []app.AdminUser
	exports []string
}

func (f *extRepo) QueryAudit(_ context.Context, q audit.ListQuery) ([]app.AuditEntry, int, error) {
	f.gotQuery = q
	return f.entries, f.total, nil
}

func (f *extRepo) QueryAuditExt(_ context.Context, q audit.ListQuery, ids []string) ([]app.AuditEntry, int, error) {
	f.gotQuery, f.gotExtIDs = q, ids
	return f.entries, f.total, nil
}

func (f *extRepo) UserIDsByEmailPrefix(_ context.Context, prefix string, _ int) ([]string, error) {
	f.gotPrefix = prefix
	if f.prefixIDs == nil {
		return []string{}, nil
	}
	return f.prefixIDs, nil
}

func (f *extRepo) ExportAuditCSV(_ context.Context, _ audit.ListQuery, _ []string, _ int, w io.Writer) (bool, error) {
	cw := csv.NewWriter(w)
	for _, row := range f.exportRows {
		if err := cw.Write(row); err != nil {
			return f.exportTrunc, err
		}
	}
	cw.Flush()
	return f.exportTrunc, cw.Error()
}

func (f *extRepo) GetUserByID(_ context.Context, id string) (app.AdminUser, bool, error) {
	for _, u := range f.users {
		if u.ID == id {
			return u, true, nil
		}
	}
	return app.AdminUser{}, false, nil
}

func (f *extRepo) ExportUserdata(_ context.Context, userID string) (map[string]any, error) {
	f.exports = append(f.exports, userID)
	return map[string]any{"user_id": userID}, nil
}

var exportCSVHeader = []string{"created_at", "actor_type", "actor_id", "actor_email", "action", "resource_type", "resource_id", "request_id", "metadata"}

func newExtMux(t *testing.T, repo *extRepo) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	svc := app.NewAdminService(repo, func() time.Time { return time.Now() })
	Mount(mux, Deps{Svc: svc})
	MountUserOps(mux, UserOpsDeps{Deps: Deps{Svc: svc}, Ops: app.NewUserOpsService(svc)})
	return mux
}

func extReq(t *testing.T, mux *http.ServeMux, path string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, path, nil)
	r = r.WithContext(webx.WithPrincipal(r.Context(), &webx.Principal{UserID: "op", IsPlatformAdmin: true}))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestListAudit_ActorParam(t *testing.T) {
	const uuid = "11111111-2222-3333-4444-555555555555"

	t.Run("actor=uuid 直配 actor_id", func(t *testing.T) {
		repo := &extRepo{entries: []app.AuditEntry{{ID: "e1"}}, total: 1}
		w := extReq(t, newExtMux(t, repo), "/api/admin/audit?actor="+uuid)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Equal(t, uuid, repo.gotQuery.ActorID)
		assert.Nil(t, repo.gotExtIDs)
	})

	t.Run("actor=邮箱前缀 转多账号 IN", func(t *testing.T) {
		repo := &extRepo{prefixIDs: []string{"u1", "u2"}, entries: []app.AuditEntry{{ID: "e1"}, {ID: "e2"}}, total: 2}
		w := extReq(t, newExtMux(t, repo), "/api/admin/audit?actor=alice%40corp.com")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Equal(t, "alice@corp.com", repo.gotPrefix)
		assert.Equal(t, []string{"u1", "u2"}, repo.gotExtIDs)

		var body struct {
			Items []app.AuditEntry `json:"items"`
			Total int              `json:"total"`
		}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		assert.Equal(t, 2, body.Total)
		require.Len(t, body.Items, 2)
	})

	t.Run("actor 邮箱零匹配：空结果 200", func(t *testing.T) {
		repo := &extRepo{}
		w := extReq(t, newExtMux(t, repo), "/api/admin/audit?actor=ghost%40nowhere")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var body struct {
			Items []app.AuditEntry `json:"items"`
			Total int              `json:"total"`
		}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		assert.Empty(t, body.Items)
		assert.Zero(t, body.Total)
		assert.Nil(t, repo.gotExtIDs, "零匹配不打审计表")
	})

	t.Run("actor 与 actor_id 同传：actor_id 优先", func(t *testing.T) {
		repo := &extRepo{prefixIDs: []string{"u1"}}
		w := extReq(t, newExtMux(t, repo), "/api/admin/audit?actor=alice%40corp.com&actor_id=u-direct")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Equal(t, "u-direct", repo.gotQuery.ActorID)
		assert.Empty(t, repo.gotPrefix)
	})
}

func TestExportAudit_CSV(t *testing.T) {
	rows := [][]string{exportCSVHeader, {"2026-10-07T00:00:00Z", "user", "u1", "a@x.com", "admin.user_kick", "user", "u2", "", "{}"}}

	t.Run("未截断：CSV 附件 + X-Export-Truncated: false", func(t *testing.T) {
		repo := &extRepo{entries: []app.AuditEntry{{ID: "e1"}}, total: 3, exportRows: rows}
		w := extReq(t, newExtMux(t, repo), "/api/admin/audit/export.csv?action=admin.user_kick")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Equal(t, "text/csv; charset=utf-8", w.Header().Get("Content-Type"))
		assert.Contains(t, w.Header().Get("Content-Disposition"), `attachment; filename="audit-admin-`)
		assert.Equal(t, "false", w.Header().Get("X-Export-Truncated"))
		assert.Equal(t, "admin.user_kick", repo.gotQuery.Action)
		lines := strings.Split(strings.TrimSpace(w.Body.String()), "\n")
		require.Len(t, lines, 2, "表头 + 1 行")
		assert.Contains(t, lines[0], "actor_email")
	})

	t.Run("命中超上限：X-Export-Truncated: true（前置 COUNT 判定）", func(t *testing.T) {
		repo := &extRepo{total: 60000, exportRows: rows, exportTrunc: true}
		w := extReq(t, newExtMux(t, repo), "/api/admin/audit/export.csv")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Equal(t, "true", w.Header().Get("X-Export-Truncated"))
		assert.Equal(t, 1, repo.gotQuery.Limit, "COUNT 复用 QueryAudit 时 limit 收敛为 1")
	})

	t.Run("actor 邮箱过滤透传导出", func(t *testing.T) {
		repo := &extRepo{prefixIDs: []string{"u9"}, total: 1, exportRows: rows}
		w := extReq(t, newExtMux(t, repo), "/api/admin/audit/export.csv?actor=alice%40corp.com")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Equal(t, []string{"u9"}, repo.gotExtIDs)
		assert.Equal(t, "false", w.Header().Get("X-Export-Truncated"))
	})
}

func TestExportUserdata_HTTP(t *testing.T) {
	u1 := app.AdminUser{ID: "u1", Email: "u1@x.com", Status: "active"}

	t.Run("200：JSON 附件（Content-Disposition 在正文前）", func(t *testing.T) {
		repo := &extRepo{users: []app.AdminUser{u1}}
		w := extReq(t, newExtMux(t, repo), "/api/admin/users/u1/export")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Equal(t, `attachment; filename="userdata-u1.json"`, w.Header().Get("Content-Disposition"))
		assert.Contains(t, w.Header().Get("Content-Type"), "application/json")
		assert.Equal(t, []string{"u1"}, repo.exports)
		assert.Contains(t, w.Body.String(), `"user_id":"u1"`)
	})

	t.Run("目标不存在 404（E_NOT_FOUND 信封）", func(t *testing.T) {
		repo := &extRepo{}
		w := extReq(t, newExtMux(t, repo), "/api/admin/users/ghost/export")
		assert.Equal(t, http.StatusNotFound, w.Code)
		assert.Contains(t, w.Body.String(), "E_NOT_FOUND")
		assert.Empty(t, repo.exports)
	})

	t.Run("Ops 未接线 503", func(t *testing.T) {
		repo := &extRepo{users: []app.AdminUser{u1}}
		mux := http.NewServeMux()
		svc := app.NewAdminService(repo, func() time.Time { return time.Now() })
		MountUserOps(mux, UserOpsDeps{Deps: Deps{Svc: svc}, Ops: nil})
		w := extReq(t, mux, "/api/admin/users/u1/export")
		assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	})

	t.Run("非平台管理员 403", func(t *testing.T) {
		repo := &extRepo{users: []app.AdminUser{u1}}
		mux := newExtMux(t, repo)
		r := httptest.NewRequest(http.MethodGet, "/api/admin/users/u1/export", nil)
		r = r.WithContext(webx.WithPrincipal(r.Context(), &webx.Principal{UserID: "m", IsPlatformAdmin: false}))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		assert.Equal(t, http.StatusForbidden, w.Code)
	})
}

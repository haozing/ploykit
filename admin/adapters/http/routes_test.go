package http

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/admin"
	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/audit"
	"github.com/haozing/ploykit/platform/webx"
)

type fakeRepo struct {
	app.Repo

	gotQuery audit.ListQuery
	entries  []app.AuditEntry
	total    int

	users       []app.AdminUser
	userTotal   int
	workspaces  []app.AdminWorkspace
	wsTotal     int
	changeFrom  string
	gotPlanCall struct{ ws, to string }

	gotAdminCall struct {
		userID  string
		isAdmin bool
	}
}

func (f *fakeRepo) QueryAudit(_ context.Context, q audit.ListQuery) ([]app.AuditEntry, int, error) {
	f.gotQuery = q
	return f.entries, f.total, nil
}

func (f *fakeRepo) ListUsers(_ context.Context, _, _ string, _, _ int) ([]app.AdminUser, error) {
	return f.users, nil
}

func (f *fakeRepo) CountUsers(_ context.Context, q, status string) (int, error) {
	return f.userTotal, nil
}

func (f *fakeRepo) PlanExists(_ context.Context, code string) (bool, error) {
	return code == "free" || code == "pro", nil
}

func (f *fakeRepo) ListWorkspaces(_ context.Context, _ string, _, _ int) ([]app.AdminWorkspace, error) {
	return f.workspaces, nil
}

func (f *fakeRepo) CountWorkspaces(_ context.Context, _ string) (int, error) { return f.wsTotal, nil }

func (f *fakeRepo) AnalyticsSummary(_ context.Context, _ time.Time) ([]app.AnalyticsSummary, error) {
	return []app.AnalyticsSummary{}, nil
}

func (f *fakeRepo) ChangePlan(_ context.Context, ws, to, _, _ string, _ time.Time) (string, error) {
	f.gotPlanCall.ws, f.gotPlanCall.to = ws, to
	return f.changeFrom, nil
}

func (f *fakeRepo) SetPlatformAdmin(_ context.Context, userID string, isAdmin bool) error {
	f.gotAdminCall.userID, f.gotAdminCall.isAdmin = userID, isAdmin
	return nil
}

func (f *fakeRepo) SetUserStatus(_ context.Context, userID, status string) error { return nil }

func newAdminMux(t *testing.T, repo app.Repo) (*http.ServeMux, *httptest.Server) {
	t.Helper()
	mux := http.NewServeMux()
	Mount(mux, Deps{Svc: app.NewAdminService(repo, func() time.Time { return time.Now() })})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return mux, srv
}

func adminReq(t *testing.T, mux *http.ServeMux, admin bool, path string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, path, nil)
	r = r.WithContext(webx.WithPrincipal(r.Context(), &webx.Principal{UserID: "op", IsPlatformAdmin: admin}))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestListAudit_Auth(t *testing.T) {
	fake := &fakeRepo{}
	mux, _ := newAdminMux(t, fake)

	t.Run("未认证 401", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/api/admin/audit", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
	t.Run("非平台管理员 403", func(t *testing.T) {
		w := adminReq(t, mux, false, "/api/admin/audit")
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "E_FORBIDDEN")
	})

	t.Run("模拟会话（即便目标已提权）403", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/api/admin/audit", nil)
		r = r.WithContext(webx.WithPrincipal(r.Context(), &webx.Principal{
			UserID: "u-member", IsPlatformAdmin: true, Source: webx.SourceSession, ImpersonatedBy: "op",
		}))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "impersonated")
	})
}

func TestListAudit_Filters(t *testing.T) {
	from := "2026-10-01T00:00:00Z"
	to := "2026-10-05T12:30:00%2B08:00"

	t.Run("同名参数透传 Query", func(t *testing.T) {
		fake := &fakeRepo{entries: []app.AuditEntry{{ID: "e1", Action: "task.created"}}, total: 7}
		mux, _ := newAdminMux(t, fake)
		w := adminReq(t, mux, true,
			"/api/admin/audit?workspace=11111111-2222-3333-4444-555555555555&actor_id=u9&action=task.created&resource_type=task&from="+from+"&to="+to+"&limit=10&offset=5")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		q := fake.gotQuery
		assert.Equal(t, "11111111-2222-3333-4444-555555555555", q.WorkspaceID)
		assert.Equal(t, "u9", q.ActorID)
		assert.Equal(t, "task.created", q.Action)
		assert.Equal(t, "task", q.ResourceType)
		require.NotNil(t, q.From)
		assert.Equal(t, "2026-10-01T00:00:00Z", q.From.Format(time.RFC3339))
		require.NotNil(t, q.To)
		assert.Equal(t, "2026-10-05T04:30:00Z", q.To.UTC().Format(time.RFC3339), "带时区的 RFC3339 正确解析")
		assert.Equal(t, 10, q.Limit)
		assert.Equal(t, 5, q.Offset)

		var body struct {
			Items []app.AuditEntry `json:"items"`
			Total int              `json:"total"`
		}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		assert.Equal(t, 7, body.Total)
		require.Len(t, body.Items, 1)
		assert.Equal(t, "task.created", body.Items[0].Action)
	})

	t.Run("无参数全零值（空 = 全部）", func(t *testing.T) {
		fake := &fakeRepo{}
		mux, _ := newAdminMux(t, fake)
		w := adminReq(t, mux, true, "/api/admin/audit")
		require.Equal(t, http.StatusOK, w.Code)
		assert.Empty(t, fake.gotQuery.WorkspaceID)
		assert.Nil(t, fake.gotQuery.From)
		assert.Nil(t, fake.gotQuery.To)
		assert.Zero(t, fake.gotQuery.Limit, "0 交给 Query 钳制成缺省")
	})

	t.Run("非法 from 400", func(t *testing.T) {
		fake := &fakeRepo{}
		mux, _ := newAdminMux(t, fake)
		w := adminReq(t, mux, true, "/api/admin/audit?from=2026-10-05")
		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Contains(t, w.Body.String(), "E_VALIDATION")
	})

	t.Run("非法 to 400", func(t *testing.T) {
		fake := &fakeRepo{}
		mux, _ := newAdminMux(t, fake)
		w := adminReq(t, mux, true, "/api/admin/audit?to=oops")
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("非法 workspace uuid 400", func(t *testing.T) {
		fake := &fakeRepo{}
		mux, _ := newAdminMux(t, fake)
		w := adminReq(t, mux, true, "/api/admin/audit?workspace=not-a-uuid")
		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Contains(t, w.Body.String(), "E_VALIDATION")
	})

	t.Run("legacy limit 非整数维持旧行为（忽略取缺省，不 400）", func(t *testing.T) {
		fake := &fakeRepo{}
		mux, _ := newAdminMux(t, fake)
		w := adminReq(t, mux, true, "/api/admin/audit?limit=abc")
		assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Zero(t, fake.gotQuery.Limit)
	})
}

type fakeUserRepo struct {
	app.Repo
	users map[string]app.AdminUser
}

func (f *fakeUserRepo) GetUserByID(_ context.Context, id string) (app.AdminUser, bool, error) {
	u, ok := f.users[id]
	return u, ok, nil
}

type fakeMinter struct {
	calls             int
	gotUserID         string
	gotIPHash         string
	gotUserAgent      string
	gotImpersonator   string
	err               error
	returnedTokenHook int
}

func (f *fakeMinter) CreateSession(_ context.Context, userID, ipHash, userAgent string, _ time.Time) (string, time.Time, error) {
	return f.create(userID, "", ipHash, userAgent)
}

func (f *fakeMinter) CreateImpersonatedSession(_ context.Context, userID, impersonatedBy, ipHash, userAgent string, _ time.Time) (string, time.Time, error) {
	return f.create(userID, impersonatedBy, ipHash, userAgent)
}

func (f *fakeMinter) create(userID, impersonatedBy, ipHash, userAgent string) (string, time.Time, error) {
	f.calls++
	f.gotUserID, f.gotIPHash, f.gotUserAgent, f.gotImpersonator = userID, ipHash, userAgent, impersonatedBy
	if f.err != nil {
		return "", time.Time{}, f.err
	}
	return "tok-imp-1", time.Now().Add(time.Hour), nil
}

type fakeAuditRec struct {
	recordCalls     int
	gotP            *webx.Principal
	gotAction       string
	gotResourceType string
	gotResourceID   string
	gotMeta         map[string]any
}

func (f *fakeAuditRec) Record(_ context.Context, _ *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any) {
	f.recordCalls++
	f.gotP, f.gotAction, f.gotResourceType, f.gotResourceID, f.gotMeta =
		p, action, resourceType, resourceID, meta
}

func impUser(id string, admin bool, status string) app.AdminUser {
	return app.AdminUser{ID: id, Email: id + "@test.local", DisplayName: id, Status: status, IsPlatformAdmin: admin, EmailVerified: true, CreatedAt: time.Now()}
}

func newImpMux(t *testing.T, repo app.Repo, minter SessionMinter, rec AuditRecorder, hooks *admin.Hooks) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	Mount(mux, Deps{
		Svc:      app.NewAdminService(repo, func() time.Time { return time.Now() }),
		Rec:      rec,
		Sessions: minter,
		AuthCfg:  &webx.AuthConfig{CookieName: "tk_auth"},
		Hooks:    hooks,
	})
	return mux
}

func impReq(t *testing.T, mux *http.ServeMux, p *webx.Principal, path string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, path, nil)
	r.Header.Set("User-Agent", "httptest-ua")
	if p != nil {
		r = r.WithContext(webx.WithPrincipal(r.Context(), p))
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestImpersonate(t *testing.T) {
	adminP := &webx.Principal{UserID: "op", Email: "op@test.local", IsPlatformAdmin: true, Source: webx.SourceSession}
	member := impUser("u-member", false, "active")
	anotherAdmin := impUser("u-admin2", true, "active")
	disabled := impUser("u-disabled", false, "disabled")
	repo := &fakeUserRepo{users: map[string]app.AdminUser{
		member.ID: member, anotherAdmin.ID: anotherAdmin, disabled.ID: disabled,
	}}

	t.Run("未认证 401", func(t *testing.T) {
		mux := newImpMux(t, repo, &fakeMinter{}, &fakeAuditRec{}, nil)
		w := impReq(t, mux, nil, "/api/admin/users/u-member/impersonate")
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("非平台管理员 403", func(t *testing.T) {
		mux := newImpMux(t, repo, &fakeMinter{}, &fakeAuditRec{}, nil)
		w := impReq(t, mux, &webx.Principal{UserID: "op", IsPlatformAdmin: false}, "/api/admin/users/u-member/impersonate")
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "E_FORBIDDEN")
	})

	t.Run("Sessions 未接线 503", func(t *testing.T) {
		mux := newImpMux(t, repo, nil, &fakeAuditRec{}, nil)
		w := impReq(t, mux, adminP, "/api/admin/users/u-member/impersonate")
		assert.Equal(t, http.StatusServiceUnavailable, w.Code)
		assert.Contains(t, w.Body.String(), "E_UNAVAILABLE")
	})

	t.Run("AuthCfg 未接线 503", func(t *testing.T) {
		mux := http.NewServeMux()
		Mount(mux, Deps{
			Svc:      app.NewAdminService(repo, func() time.Time { return time.Now() }),
			Sessions: &fakeMinter{},
		})
		w := impReq(t, mux, adminP, "/api/admin/users/u-member/impersonate")
		assert.Equal(t, http.StatusServiceUnavailable, w.Code)
		assert.Contains(t, w.Body.String(), "E_UNAVAILABLE")
	})

	t.Run("目标不存在 404", func(t *testing.T) {
		minter := &fakeMinter{}
		mux := newImpMux(t, repo, minter, &fakeAuditRec{}, nil)
		w := impReq(t, mux, adminP, "/api/admin/users/u-nobody/impersonate")
		assert.Equal(t, http.StatusNotFound, w.Code)
		assert.Contains(t, w.Body.String(), "E_NOT_FOUND")
		assert.Zero(t, minter.calls)
	})

	t.Run("目标非 active 403", func(t *testing.T) {
		minter := &fakeMinter{}
		mux := newImpMux(t, repo, minter, &fakeAuditRec{}, nil)
		w := impReq(t, mux, adminP, "/api/admin/users/u-disabled/impersonate")
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "E_FORBIDDEN")
		assert.Zero(t, minter.calls)
	})

	t.Run("目标是平台管理员 403（防权限逃逸）", func(t *testing.T) {
		minter := &fakeMinter{}
		mux := newImpMux(t, repo, minter, &fakeAuditRec{}, nil)
		w := impReq(t, mux, adminP, "/api/admin/users/u-admin2/impersonate")
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "E_FORBIDDEN")
		assert.Zero(t, minter.calls, "拒绝路径不得签发会话")
	})

	t.Run("模拟会话再模拟 403（防链式，AD6-v2）", func(t *testing.T) {
		minter := &fakeMinter{}
		mux := newImpMux(t, repo, minter, &fakeAuditRec{}, nil)
		impP := &webx.Principal{
			UserID: "u-member", Email: "u-member@test.local", IsPlatformAdmin: true,
			Source: webx.SourceSession, ImpersonatedBy: "op",
		}
		w := impReq(t, mux, impP, "/api/admin/users/u-member2/impersonate")
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "E_FORBIDDEN")
		assert.Zero(t, minter.calls, "链式模拟拒绝路径不得签发会话")
	})

	t.Run("模拟自己 400", func(t *testing.T) {
		minter := &fakeMinter{}
		mux := newImpMux(t, repo, minter, &fakeAuditRec{}, nil)
		w := impReq(t, mux, adminP, "/api/admin/users/op/impersonate")
		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Contains(t, w.Body.String(), "E_VALIDATION")
		assert.Zero(t, minter.calls)
	})

	t.Run("成功 200：签发目标会话 + cookie + 审计 + 钩子", func(t *testing.T) {
		minter := &fakeMinter{}
		rec := &fakeAuditRec{}
		var hookAdminID, hookTargetID string
		hookCalls := 0
		hooks := &admin.Hooks{OnImpersonation: func(_ context.Context, adminUserID, targetUserID string) error {
			hookCalls++
			hookAdminID, hookTargetID = adminUserID, targetUserID
			return nil
		}}
		mux := newImpMux(t, repo, minter, rec, hooks)
		w := impReq(t, mux, adminP, "/api/admin/users/u-member/impersonate")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		assert.Equal(t, 1, minter.calls)
		assert.Equal(t, "u-member", minter.gotUserID)
		assert.NotEmpty(t, minter.gotIPHash, "会话记录须带 IP 指纹")
		assert.Equal(t, "httptest-ua", minter.gotUserAgent)
		assert.Equal(t, "op", minter.gotImpersonator, "impersonated_by 必须是发起管理员（AD6-v2）")

		assert.Contains(t, w.Header().Get("Set-Cookie"), "tk_auth=tok-imp-1")
		assert.Contains(t, w.Header().Get("Set-Cookie"), "HttpOnly")

		assert.Equal(t, 1, rec.recordCalls)
		assert.Equal(t, "admin.impersonate", rec.gotAction)
		assert.Equal(t, "user", rec.gotResourceType)
		assert.Equal(t, "u-member", rec.gotResourceID)
		require.NotNil(t, rec.gotP)
		assert.Equal(t, "op", rec.gotP.UserID, "审计 actor 是管理员本人")
		assert.Equal(t, member.Email, rec.gotMeta["target_email"])
		assert.Equal(t, webx.HashToken("tok-imp-1"), rec.gotMeta["session_token_hash"],
			"meta 携带目标会话指纹（sha256 摘要，非明文令牌）")
		assert.NotContains(t, fmt.Sprint(rec.gotMeta), "tok-imp-1", "明文会话令牌绝不入审计")

		assert.Equal(t, 1, hookCalls)
		assert.Equal(t, "op", hookAdminID)
		assert.Equal(t, "u-member", hookTargetID)

		var body struct {
			User app.AdminUser `json:"user"`
		}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		assert.Equal(t, "u-member", body.User.ID)
		assert.Equal(t, member.Email, body.User.Email)
	})

	t.Run("钩子返回 error 不影响响应（Observational）", func(t *testing.T) {
		hooks := &admin.Hooks{OnImpersonation: func(context.Context, string, string) error {
			return io.ErrClosedPipe
		}}
		mux := newImpMux(t, repo, &fakeMinter{}, &fakeAuditRec{}, hooks)
		w := impReq(t, mux, adminP, "/api/admin/users/u-member/impersonate")
		assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	})

	t.Run("钩子 nil 安全（未接线 Hooks / 未设置字段）", func(t *testing.T) {
		mux := newImpMux(t, repo, &fakeMinter{}, &fakeAuditRec{}, nil)
		w := impReq(t, mux, adminP, "/api/admin/users/u-member/impersonate")
		assert.Equal(t, http.StatusOK, w.Code, w.Body.String())

		mux2 := newImpMux(t, repo, &fakeMinter{}, &fakeAuditRec{}, &admin.Hooks{})
		w2 := impReq(t, mux2, adminP, "/api/admin/users/u-member/impersonate")
		assert.Equal(t, http.StatusOK, w2.Code, w2.Body.String())
	})

	t.Run("审计未接线（Rec=nil）仍可模拟", func(t *testing.T) {
		mux := newImpMux(t, repo, &fakeMinter{}, nil, nil)
		w := impReq(t, mux, adminP, "/api/admin/users/u-member/impersonate")
		assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	})

	t.Run("会话签发失败 500", func(t *testing.T) {
		minter := &fakeMinter{err: io.ErrClosedPipe}
		mux := newImpMux(t, repo, minter, &fakeAuditRec{}, nil)
		w := impReq(t, mux, adminP, "/api/admin/users/u-member/impersonate")
		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func TestListUsers_Envelope(t *testing.T) {
	repo := &fakeRepo{users: []app.AdminUser{{ID: "u1", Email: "u1@test.local"}}, userTotal: 42}
	mux, _ := newAdminMux(t, repo)
	w := adminReq(t, mux, true, "/api/admin/users?page=2&page_size=20")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var body struct {
		Items []app.AdminUser `json:"items"`
		Total int             `json:"total"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Equal(t, 42, body.Total)
	require.Len(t, body.Items, 1)
	assert.Equal(t, "u1", body.Items[0].ID)
}

func TestListWorkspaces_Envelope(t *testing.T) {
	repo := &fakeRepo{workspaces: []app.AdminWorkspace{{ID: "ws1", Slug: "ws-1"}}, wsTotal: 7}
	mux, _ := newAdminMux(t, repo)
	w := adminReq(t, mux, true, "/api/admin/workspaces")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var body struct {
		Items []app.AdminWorkspace `json:"items"`
		Total int                  `json:"total"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Equal(t, 7, body.Total)
	require.Len(t, body.Items, 1)
	assert.Equal(t, "ws1", body.Items[0].ID)
}

func TestAnalytics_DaysValidation(t *testing.T) {
	t.Run("缺省 7 天（不传 days）", func(t *testing.T) {
		repo := &fakeRepo{}
		mux, _ := newAdminMux(t, repo)
		w := adminReq(t, mux, true, "/api/admin/analytics")
		assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	})

	t.Run("合法窗口 200", func(t *testing.T) {
		repo := &fakeRepo{}
		mux, _ := newAdminMux(t, repo)
		assert.Equal(t, http.StatusOK, adminReq(t, mux, true, "/api/admin/analytics?days=1").Code)
		assert.Equal(t, http.StatusOK, adminReq(t, mux, true, "/api/admin/analytics?days=90").Code)
	})

	for _, tc := range []struct {
		q, why string
	}{
		{q: "days=0", why: "零"},
		{q: "days=-3", why: "负数"},
		{q: "days=91", why: "超上限"},
		{q: "days=abc", why: "非整数"},
	} {
		t.Run("非法 days 400："+tc.why, func(t *testing.T) {
			repo := &fakeRepo{}
			mux, _ := newAdminMux(t, repo)
			w := adminReq(t, mux, true, "/api/admin/analytics?"+tc.q)
			assert.Equal(t, http.StatusBadRequest, w.Code)
			assert.Contains(t, w.Body.String(), "E_VALIDATION")
			assert.Contains(t, w.Body.String(), "days must be an integer between 1 and 90")
		})
	}
}

func TestSetUserStatus_Audits(t *testing.T) {
	adminP := &webx.Principal{UserID: "op", Email: "op@test.local", IsPlatformAdmin: true}

	statusReq := func(mux *http.ServeMux, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPatch, path, strings.NewReader(body))
		r = r.WithContext(webx.WithPrincipal(r.Context(), adminP))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}

	t.Run("封禁 200 + 审计 admin.user_disable", func(t *testing.T) {
		rec := &fakeAuditRec{}
		mux := http.NewServeMux()
		Mount(mux, Deps{
			Svc: app.NewAdminService(&fakeRepo{}, func() time.Time { return time.Now() }).WithAuditor(rec),
		})
		w := statusReq(mux, "/api/admin/users/u-42/status", `{"status":"disabled"}`)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		require.Equal(t, 1, rec.recordCalls)
		assert.Equal(t, "admin.user_disable", rec.gotAction)
		assert.Equal(t, "user", rec.gotResourceType)
		assert.Equal(t, "u-42", rec.gotResourceID)
		require.NotNil(t, rec.gotP)
		assert.Equal(t, "op", rec.gotP.UserID, "审计 actor 是管理员本人")
		assert.Equal(t, "u-42", rec.gotMeta["user_id"])
	})

	t.Run("解禁 200 + 审计 admin.user_enable", func(t *testing.T) {
		rec := &fakeAuditRec{}
		mux := http.NewServeMux()
		Mount(mux, Deps{
			Svc: app.NewAdminService(&fakeRepo{}, func() time.Time { return time.Now() }).WithAuditor(rec),
		})
		w := statusReq(mux, "/api/admin/users/u-42/status", `{"status":"active"}`)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		require.Equal(t, 1, rec.recordCalls)
		assert.Equal(t, "admin.user_enable", rec.gotAction)
		assert.Equal(t, "u-42", rec.gotResourceID)
	})

	t.Run("非法 status 400 不写审计", func(t *testing.T) {
		rec := &fakeAuditRec{}
		mux := http.NewServeMux()
		Mount(mux, Deps{
			Svc: app.NewAdminService(&fakeRepo{}, func() time.Time { return time.Now() }).WithAuditor(rec),
		})
		w := statusReq(mux, "/api/admin/users/u-42/status", `{"status":"banned"}`)
		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Zero(t, rec.recordCalls)
	})
}

func TestChangePlan_AuditsViaDeps(t *testing.T) {
	adminP := &webx.Principal{UserID: "op", Email: "op@test.local", IsPlatformAdmin: true}

	t.Run("成功 200 + 审计 admin.plan_change（meta from/to）", func(t *testing.T) {
		repo := &fakeRepo{changeFrom: "free"}
		rec := &fakeAuditRec{}
		mux := http.NewServeMux()
		Mount(mux, Deps{
			Svc: app.NewAdminService(repo, func() time.Time { return time.Now() }).WithAuditor(rec),
		})
		r := httptest.NewRequest(http.MethodPatch, "/api/admin/workspaces/ws-9/plan", strings.NewReader(`{"plan_code":"pro"}`))
		r = r.WithContext(webx.WithPrincipal(r.Context(), adminP))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		assert.Equal(t, "ws-9", repo.gotPlanCall.ws)
		assert.Equal(t, "pro", repo.gotPlanCall.to)
		require.Equal(t, 1, rec.recordCalls)
		assert.Equal(t, "admin.plan_change", rec.gotAction)
		assert.Equal(t, "workspace", rec.gotResourceType)
		assert.Equal(t, "ws-9", rec.gotResourceID)
		require.NotNil(t, rec.gotP)
		assert.Equal(t, "op", rec.gotP.UserID)
		require.NotNil(t, rec.gotMeta)
		assert.Equal(t, "free", rec.gotMeta["from"])
		assert.Equal(t, "pro", rec.gotMeta["to"])
	})

	t.Run("审计未接线仍可改套餐（Observational）", func(t *testing.T) {
		mux, _ := newAdminMux(t, &fakeRepo{changeFrom: "pro"})
		r := httptest.NewRequest(http.MethodPatch, "/api/admin/workspaces/ws-9/plan", strings.NewReader(`{"plan_code":"free"}`))
		r = r.WithContext(webx.WithPrincipal(r.Context(), adminP))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		assert.Equal(t, http.StatusOK, w.Code)
	})
}

func TestSetAdmin_AuditsRoleChange(t *testing.T) {
	adminP := &webx.Principal{UserID: "op", Email: "op@test.local", IsPlatformAdmin: true}

	t.Run("提权 200 + 审计 admin.user_role_change（meta is_admin=true）", func(t *testing.T) {
		repo := &fakeRepo{}
		rec := &fakeAuditRec{}
		mux := http.NewServeMux()
		Mount(mux, Deps{
			Svc: app.NewAdminService(repo, func() time.Time { return time.Now() }).WithAuditor(rec),
		})
		r := httptest.NewRequest(http.MethodPatch, "/api/admin/users/u-42/admin", strings.NewReader(`{"is_admin":true}`))
		r = r.WithContext(webx.WithPrincipal(r.Context(), adminP))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		assert.Equal(t, "u-42", repo.gotAdminCall.userID)
		assert.True(t, repo.gotAdminCall.isAdmin)
		require.Equal(t, 1, rec.recordCalls)
		assert.Equal(t, "admin.user_role_change", rec.gotAction)
		assert.Equal(t, "user", rec.gotResourceType)
		assert.Equal(t, "u-42", rec.gotResourceID)
		require.NotNil(t, rec.gotP)
		assert.Equal(t, "op", rec.gotP.UserID)
		require.NotNil(t, rec.gotMeta)
		assert.Equal(t, true, rec.gotMeta["is_admin"])
	})

	t.Run("撤销 200 + 审计 is_admin=false", func(t *testing.T) {
		repo := &fakeRepo{}
		rec := &fakeAuditRec{}
		mux := http.NewServeMux()
		Mount(mux, Deps{
			Svc: app.NewAdminService(repo, func() time.Time { return time.Now() }).WithAuditor(rec),
		})
		r := httptest.NewRequest(http.MethodPatch, "/api/admin/users/u-42/admin", strings.NewReader(`{"is_admin":false}`))
		r = r.WithContext(webx.WithPrincipal(r.Context(), adminP))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Equal(t, false, rec.gotMeta["is_admin"])
	})

	t.Run("自降 400 不写审计", func(t *testing.T) {
		repo := &fakeRepo{}
		rec := &fakeAuditRec{}
		mux := http.NewServeMux()
		Mount(mux, Deps{
			Svc: app.NewAdminService(repo, func() time.Time { return time.Now() }).WithAuditor(rec),
		})
		r := httptest.NewRequest(http.MethodPatch, "/api/admin/users/op/admin", strings.NewReader(`{"is_admin":false}`))
		r = r.WithContext(webx.WithPrincipal(r.Context(), adminP))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Zero(t, rec.recordCalls, "被校验拒绝的操作不应留审计")
	})

	t.Run("审计未接线仍可提权（Observational）", func(t *testing.T) {
		repo := &fakeRepo{}
		mux, _ := newAdminMux(t, repo)
		r := httptest.NewRequest(http.MethodPatch, "/api/admin/users/u-42/admin", strings.NewReader(`{"is_admin":true}`))
		r = r.WithContext(webx.WithPrincipal(r.Context(), adminP))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "u-42", repo.gotAdminCall.userID)
	})
}

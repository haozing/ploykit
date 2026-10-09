package notifyhttp

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/notify/app"
	"github.com/haozing/ploykit/platform/webx"
)

type fakeRepo struct {
	app.Repo
	inbox  []app.Notification
	listed int
	unread int

	markReadCalls int
	markReadUser  string
	markReadID    string

	markAllReadCalls int
	markAllReadUser  string

	archivedCalls int
	archivedUser  string
	archivedID    string
}

func (f *fakeRepo) ListInbox(_ context.Context, userID string, limit int) ([]app.Notification, error) {
	f.listed = limit
	return f.inbox, nil
}

func (f *fakeRepo) UnreadCount(_ context.Context, userID string) (int, error) {
	return f.unread, nil
}

func (f *fakeRepo) MarkRead(_ context.Context, userID, notificationID string) error {
	f.markReadCalls++
	f.markReadUser, f.markReadID = userID, notificationID

	if notificationID == "" || strings.HasPrefix(notificationID, "foreign:") {
		return app.ErrNotFound
	}
	return nil
}

func (f *fakeRepo) MarkAllRead(_ context.Context, userID string) error {
	f.markAllReadCalls++
	f.markAllReadUser = userID
	return nil
}

type fakeMail struct{}

func (fakeMail) SendLoginCode(context.Context, string, string) error      { return nil }
func (fakeMail) SendInvite(context.Context, string, string, string) error { return nil }
func (fakeMail) Send(context.Context, string, string, string) error       { return nil }

func newTestHandler(repo app.Repo) http.Handler {
	svc := app.NewNotifyService(repo, fakeMail{}, func() time.Time { return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) })
	mux := http.NewServeMux()
	Mount(mux, Deps{Svc: svc})
	return mux
}

func asUser(userID string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r = r.WithContext(webx.WithPrincipal(r.Context(), &webx.Principal{UserID: userID, Source: webx.SourceSession}))
		next.ServeHTTP(w, r)
	})
}

func TestRoutes_RequireAuth(t *testing.T) {
	h := newTestHandler(&fakeRepo{})
	routes := []struct{ method, path string }{
		{http.MethodGet, "/api/notifications"},
		{http.MethodGet, "/api/notifications/badge"},
		{http.MethodPost, "/api/notifications/n1/read"},
		{http.MethodPost, "/api/notifications/read-all"},
		{http.MethodPost, "/api/notifications/n1/archive"},
		{http.MethodGet, "/api/notification-preferences"},
		{http.MethodPut, "/api/notification-preferences/quota_near_limit"},
	}
	for _, rt := range routes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(rt.method, rt.path, nil))
			assert.Equal(t, http.StatusUnauthorized, rec.Code)
			var body webx.ErrorBody
			require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
			assert.Equal(t, webx.CodeUnauthenticated, body.Code)
		})
	}
}

func TestInbox_LimitBoundary(t *testing.T) {
	tests := []struct {
		name       string
		query      string
		wantStatus int
		wantLimit  int
	}{
		{"缺省 limit 归一 20", "", http.StatusOK, 20},
		{"limit=0 归一 20", "?limit=0", http.StatusOK, 20},
		{"limit=8 透传", "?limit=8", http.StatusOK, 8},
		{"limit=100 边界通过", "?limit=100", http.StatusOK, 100},
		{"limit=101 越界拒绝", "?limit=101", http.StatusBadRequest, 0},
		{"limit=200 越界拒绝", "?limit=200", http.StatusBadRequest, 0},
		{"limit 非数字拒绝", "?limit=abc", http.StatusBadRequest, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakeRepo{inbox: []app.Notification{{ID: "n1", Type: "quota_near_limit", Title: "配额将尽"}}}
			h := asUser("u1", newTestHandler(f))

			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/notifications"+tt.query, nil))

			require.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantStatus != http.StatusOK {
				var body webx.ErrorBody
				require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
				assert.Equal(t, webx.CodeValidation, body.Code)
				return
			}
			var list []app.Notification
			require.NoError(t, json.NewDecoder(rec.Body).Decode(&list))
			require.Len(t, list, 1)
			assert.Equal(t, "n1", list[0].ID)
			assert.Equal(t, "配额将尽", list[0].Title)
			assert.Equal(t, tt.wantLimit, f.listed)
		})
	}
}

func TestInbox_EmptyIsArray(t *testing.T) {
	f := &fakeRepo{inbox: nil}
	h := asUser("u1", newTestHandler(f))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/notifications", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var list []app.Notification
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&list))
	assert.Empty(t, list, "空收件箱应返回 [] 而非 null")
}

func TestBadge(t *testing.T) {
	f := &fakeRepo{unread: 7}
	h := asUser("u1", newTestHandler(f))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/notifications/badge", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var body struct {
		Count int `json:"count"`
	}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	assert.Equal(t, 7, body.Count)
}

func TestMarkRead_AndReadAll(t *testing.T) {
	f := &fakeRepo{}
	h := asUser("u1", newTestHandler(f))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/notifications/n_42/read", nil))
	require.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, 1, f.markReadCalls)
	assert.Equal(t, "u1", f.markReadUser, "已读必须限定在本人收件箱")
	assert.Equal(t, "n_42", f.markReadID)

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/notifications/read-all", nil))
	require.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, 1, f.markAllReadCalls)
	assert.Equal(t, "u1", f.markAllReadUser)
}

func TestMarkReadNotFound404_SECV8(t *testing.T) {
	f := &fakeRepo{}
	h := asUser("u1", newTestHandler(f))

	t.Run("他人的通知 404", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/notifications/foreign:n9/read", nil))
		require.Equal(t, http.StatusNotFound, rec.Code)
		var body webx.ErrorBody
		require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
		assert.Equal(t, webx.CodeNotFound, body.Code)
	})

	t.Run("本人的通知（含重复标记）204", func(t *testing.T) {
		for i := 0; i < 2; i++ {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/notifications/n_42/read", nil))
			require.Equal(t, http.StatusNoContent, rec.Code)
		}
	})
}

type fakeGate struct {
	rows    []app.Preference
	upserts []struct {
		userID string
		typ    string
		email  *bool
		inApp  *bool
	}
}

func (g *fakeGate) List(context.Context, string) ([]app.Preference, error) { return g.rows, nil }

func (g *fakeGate) Allowed(context.Context, string, string) (bool, error)      { return true, nil }
func (g *fakeGate) EmailAllowed(context.Context, string, string) (bool, error) { return true, nil }

func (g *fakeGate) Upsert(_ context.Context, userID, typ string, email, inApp *bool) (app.Preference, error) {
	g.upserts = append(g.upserts, struct {
		userID string
		typ    string
		email  *bool
		inApp  *bool
	}{userID, typ, email, inApp})
	return app.Preference{NotificationType: typ, EmailEnabled: email == nil || *email, InAppEnabled: inApp == nil || *inApp, UpdatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}, nil
}

func newPrefHandler(gate app.PrefGate) http.Handler {
	svc := app.NewNotifyService(&fakeRepo{}, fakeMail{}, func() time.Time { return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) })
	if gate != nil {
		svc = svc.WithPrefGate(gate)
	}
	mux := http.NewServeMux()
	Mount(mux, Deps{Svc: svc})
	return mux
}

func TestPreferences_List(t *testing.T) {
	t.Run("只返回显式设置过的行(items 信封)", func(t *testing.T) {
		g := &fakeGate{rows: []app.Preference{
			{NotificationType: "indexed_milestone", EmailEnabled: false, InAppEnabled: true, UpdatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)},
		}}
		h := asUser("u1", newPrefHandler(g))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/notification-preferences", nil))
		require.Equal(t, http.StatusOK, rec.Code)
		var body struct {
			Items []app.Preference `json:"items"`
		}
		require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
		require.Len(t, body.Items, 1)
		assert.Equal(t, "indexed_milestone", body.Items[0].NotificationType)
		assert.False(t, body.Items[0].EmailEnabled)
		assert.True(t, body.Items[0].InAppEnabled)
	})

	t.Run("无显式行时返回空数组而非 null", func(t *testing.T) {
		h := asUser("u1", newPrefHandler(&fakeGate{}))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/notification-preferences", nil))
		require.Equal(t, http.StatusOK, rec.Code)
		assert.JSONEq(t, `{"items":[]}`, rec.Body.String())
	})
}

func TestPreferences_Upsert(t *testing.T) {
	no := false
	tests := []struct {
		name       string
		gate       app.PrefGate
		typ        string
		body       any
		wantStatus int
		wantErr    string
		wantEmail  bool
		wantInApp  bool
	}{
		{"双渠道同时更新 200", &fakeGate{}, "quota_near_limit", map[string]any{"email_enabled": false, "in_app_enabled": true}, http.StatusOK, "", false, true},
		{"仅 email_enabled 200", &fakeGate{}, "quota_near_limit", map[string]any{"email_enabled": no}, http.StatusOK, "", false, true},
		{"仅 in_app_enabled 200", &fakeGate{}, "quota_near_limit", map[string]any{"in_app_enabled": no}, http.StatusOK, "", true, false},
		{"两个布尔都缺失 400 E_VALIDATION", &fakeGate{}, "quota_near_limit", map[string]any{}, http.StatusBadRequest, webx.CodeValidation, false, false},
		{"type 超 64 字符 400 E_VALIDATION", &fakeGate{}, strings.Repeat("a", 65), map[string]any{"email_enabled": no}, http.StatusBadRequest, webx.CodeValidation, false, false},
		{"未知字段 400 E_BAD_JSON(DisallowUnknownFields)", &fakeGate{}, "quota_near_limit", map[string]any{"email_enabled": no, "extra": 1}, http.StatusBadRequest, "E_BAD_JSON", false, false},
		{"闸门未接线 503 E_UNAVAILABLE", nil, "quota_near_limit", map[string]any{"email_enabled": no}, http.StatusServiceUnavailable, webx.CodeUnavailable, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := asUser("u1", newPrefHandler(tt.gate))
			raw, err := json.Marshal(tt.body)
			require.NoError(t, err)
			req := httptest.NewRequest(http.MethodPut, "/api/notification-preferences/"+tt.typ, bytes.NewReader(raw))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			require.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantErr != "" {
				var body webx.ErrorBody
				require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
				assert.Equal(t, tt.wantErr, body.Code)
				return
			}
			var pref app.Preference
			require.NoError(t, json.NewDecoder(rec.Body).Decode(&pref))
			assert.Equal(t, tt.typ, pref.NotificationType)
			assert.Equal(t, tt.wantEmail, pref.EmailEnabled)
			assert.Equal(t, tt.wantInApp, pref.InAppEnabled)
		})
	}

	t.Run("Upsert 限定本人并透传 type 与指针语义", func(t *testing.T) {
		g := &fakeGate{}
		h := asUser("u1", newPrefHandler(g))
		req := httptest.NewRequest(http.MethodPut, "/api/notification-preferences/quota_near_limit",
			bytes.NewReader([]byte(`{"in_app_enabled": false}`)))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)
		require.Len(t, g.upserts, 1)
		assert.Equal(t, "u1", g.upserts[0].userID, "偏好必须限定在本人")
		assert.Equal(t, "quota_near_limit", g.upserts[0].typ)
		assert.Nil(t, g.upserts[0].email, "请求未出现的字段应保持原值")
		require.NotNil(t, g.upserts[0].inApp)
		assert.False(t, *g.upserts[0].inApp)
	})
}

func (f *fakeRepo) Archive(_ context.Context, userID, notificationID string) error {
	if notificationID == "" || strings.HasPrefix(notificationID, "foreign:") {
		return app.ErrNotFound
	}
	f.archivedCalls++
	f.archivedUser, f.archivedID = userID, notificationID
	return nil
}

func TestArchive_Wiring(t *testing.T) {
	h := asUser("u1", newTestHandler(&fakeRepo{}))

	t.Run("归档成功 204", func(t *testing.T) {
		f := &fakeRepo{}
		hh := asUser("u1", newTestHandler(f))
		rec := httptest.NewRecorder()
		hh.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/notifications/n1/archive", nil))
		assert.Equal(t, http.StatusNoContent, rec.Code)
		assert.Equal(t, 1, f.archivedCalls)
		assert.Equal(t, "n1", f.archivedID)
	})
	t.Run("不存在/非本人 404", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/notifications/foreign:n1/archive", nil))
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})
	t.Run("重复归档幂等 204", func(t *testing.T) {
		f := &fakeRepo{}
		hh := asUser("u1", newTestHandler(f))
		for range 2 {
			rec := httptest.NewRecorder()
			hh.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/notifications/n1/archive", nil))
			assert.Equal(t, http.StatusNoContent, rec.Code)
		}
	})
}

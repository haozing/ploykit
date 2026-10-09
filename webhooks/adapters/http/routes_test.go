package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/webhooks/app"
)

type fakeRepo struct {
	app.Repo
	subs      map[string]app.Subscription
	pinged    []string
	activeTo  map[string]bool
	redeliver map[string]app.Delivery

	rotateSub string
	rotateErr error
}

const testWS = "ws-http"

func newDeps(t *testing.T, repo *fakeRepo) Deps {
	t.Helper()
	svc := app.NewWebhookService(repo, app.NewEventCatalog(), nil, func() time.Time {
		return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	}).WithSecrets(testSecrets{})

	return Deps{
		Service: svc,
		MemberCheck: func(_ context.Context, workspaceID, userID string) (string, bool, error) {
			switch userID {
			case "u-owner":
				return authz.RoleOwner, true, nil
			case "u-member":
				return authz.RoleMember, true, nil
			}
			return "", false, nil
		},
		Authz: authz.New(authz.DefaultCatalog(), authz.DefaultRoles()),
	}
}

type testSecrets struct{}

func (testSecrets) Seal(p string) (string, error) { return "sealed:v1:" + p, nil }

func (testSecrets) Unseal(s string) (string, error) { return strings.TrimPrefix(s, "sealed:v1:"), nil }

func do(mux *http.ServeMux, method, target, userID, body string) *httptest.ResponseRecorder {
	var rd *bytes.Reader
	if body == "" {
		rd = bytes.NewReader(nil)
	} else {
		rd = bytes.NewReader([]byte(body))
	}
	r := httptest.NewRequest(method, target, rd)
	if userID != "" {
		r = r.WithContext(webx.WithPrincipal(r.Context(), &webx.Principal{UserID: userID}))
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func newTestMux(t *testing.T) (*fakeRepo, *http.ServeMux) {
	t.Helper()
	repo := &fakeRepo{
		subs: map[string]app.Subscription{
			"sub-1": {ID: "sub-1", WorkspaceID: testWS, URL: "https://example.com/h", IsActive: true},
		},
		activeTo:  map[string]bool{},
		redeliver: map[string]app.Delivery{},
	}
	repo.redeliver["dlv-1"] = app.Delivery{
		ID: "dlv-new", SubscriptionID: "sub-1",
		EventID: "evt-1", EventType: "task.created",
		Status: app.StatusPending, Attempts: 0, CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	mux := http.NewServeMux()
	Mount(mux, newDeps(t, repo))
	return repo, mux
}

func (f *fakeRepo) GetSubscription(_ context.Context, workspaceID, id string) (app.Subscription, bool, error) {
	s, ok := f.subs[id]
	if !ok || workspaceID != testWS {
		return app.Subscription{}, false, nil
	}
	return s, true, nil
}

func (f *fakeRepo) EnqueuePing(_ context.Context, workspaceID, subscriptionID string) error {
	if _, ok := f.subs[subscriptionID]; !ok || workspaceID != testWS {
		return app.ErrNotFound
	}
	f.pinged = append(f.pinged, subscriptionID)
	return nil
}

func (f *fakeRepo) SetSubscriptionActive(_ context.Context, workspaceID, id string, active bool, _ time.Time) error {
	if _, ok := f.subs[id]; !ok || workspaceID != testWS {
		return app.ErrNotFound
	}
	f.activeTo[id] = active
	return nil
}

func (f *fakeRepo) DeleteSubscription(_ context.Context, workspaceID, id string) error {
	if _, ok := f.subs[id]; !ok || workspaceID != testWS {
		return app.ErrNotFound
	}
	delete(f.subs, id)
	return nil
}

func (f *fakeRepo) Redeliver(_ context.Context, workspaceID, deliveryID string) (app.Delivery, error) {
	d, ok := f.redeliver[deliveryID]
	if !ok || workspaceID != testWS {
		return app.Delivery{}, app.ErrNotFound
	}
	return d, nil
}

func (f *fakeRepo) RotateSecret(_ context.Context, workspaceID, subscriptionID, newSealed string, _, _ time.Time) error {
	if f.rotateErr != nil {
		return f.rotateErr
	}
	if _, ok := f.subs[subscriptionID]; !ok || workspaceID != testWS {
		return app.ErrNotFound
	}
	f.rotateSub = subscriptionID
	return nil
}

func TestRoutesPing(t *testing.T) {
	repo, mux := newTestMux(t)
	base := "/api/workspaces/" + testWS + "/webhooks/subscriptions/sub-1/ping"

	tests := []struct {
		name     string
		userID   string
		wantCode int
		wantPing int
	}{
		{name: "未认证 401", userID: "", wantCode: http.StatusUnauthorized},
		{name: "member 无 manage 权限 403", userID: "u-member", wantCode: http.StatusForbidden},
		{name: "owner 探活 204", userID: "u-owner", wantCode: http.StatusNoContent, wantPing: 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := do(mux, http.MethodPost, base, tt.userID, "")
			if w.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d, body %s", w.Code, tt.wantCode, w.Body)
			}
			if len(repo.pinged) != tt.wantPing {
				t.Errorf("EnqueuePing 次数 = %d, want %d", len(repo.pinged), tt.wantPing)
			}
		})
	}

	w := do(mux, http.MethodPost, "/api/workspaces/"+testWS+"/webhooks/subscriptions/sub-x/ping", "u-owner", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("未知订阅 status = %d, want 404, body %s", w.Code, w.Body)
	}
	var eb webx.ErrorBody
	if err := json.Unmarshal(w.Body.Bytes(), &eb); err != nil || eb.Code != "E_NOT_FOUND" {
		t.Errorf("错误信封应含 E_NOT_FOUND, got %s err=%v", w.Body, err)
	}
}

func TestRoutesToggleActive(t *testing.T) {
	repo, mux := newTestMux(t)
	base := "/api/workspaces/" + testWS + "/webhooks/subscriptions/sub-1"

	w := do(mux, http.MethodPatch, base, "u-member", `{"is_active":false}`)
	if w.Code != http.StatusForbidden {
		t.Fatalf("member status = %d, want 403", w.Code)
	}

	w = do(mux, http.MethodPatch, base, "u-owner", `{"is_active":false}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body %s", w.Code, w.Body)
	}
	var sub app.Subscription
	if err := json.Unmarshal(w.Body.Bytes(), &sub); err != nil {
		t.Fatalf("响应应为 Subscription: %v", err)
	}
	if sub.ID != "sub-1" {
		t.Errorf("返回订阅 ID = %s, want sub-1", sub.ID)
	}
	if repo.activeTo["sub-1"] != false {
		t.Errorf("repo 应收到 is_active=false, got %v", repo.activeTo)
	}

	w = do(mux, http.MethodPatch, base, "u-owner", `{"is_active":true}`)
	if w.Code != http.StatusOK {
		t.Fatalf("恢复 status = %d, want 200", w.Code)
	}
	if repo.activeTo["sub-1"] != true {
		t.Errorf("repo 应收到 is_active=true, got %v", repo.activeTo)
	}

	for _, body := range []string{`{}`, `{"is_active":"yes"}`, `{"active":false}`} {
		w = do(mux, http.MethodPatch, base, "u-owner", body)
		if w.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want 400", body, w.Code)
		}
	}
}

func TestRoutesDeleteSubscription(t *testing.T) {
	repo, mux := newTestMux(t)
	base := "/api/workspaces/" + testWS + "/webhooks/subscriptions/sub-1"

	w := do(mux, http.MethodDelete, base, "u-member", "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("member status = %d, want 403, body %s", w.Code, w.Body)
	}

	w = do(mux, http.MethodDelete, base, "u-owner", "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204, body %s", w.Code, w.Body)
	}
	if w.Body.Len() != 0 {
		t.Fatalf("204 must have empty body, got %s", w.Body.String())
	}
	if _, ok := repo.subs["sub-1"]; ok {
		t.Fatal("subscription must be removed from repo")
	}

	w = do(mux, http.MethodDelete, base, "u-owner", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("未知订阅 status = %d, want 404, body %s", w.Code, w.Body)
	}
	var eb webx.ErrorBody
	if err := json.Unmarshal(w.Body.Bytes(), &eb); err != nil || eb.Code != "E_NOT_FOUND" {
		t.Errorf("错误信封应含 E_NOT_FOUND, got %s err=%v", w.Body, err)
	}
}

func TestRoutesRedeliver(t *testing.T) {
	_, mux := newTestMux(t)
	base := "/api/workspaces/" + testWS + "/webhooks/deliveries/dlv-1/redeliver"

	w := do(mux, http.MethodPost, base, "u-member", "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("member status = %d, want 403, body %s", w.Code, w.Body)
	}

	w = do(mux, http.MethodPost, base, "u-owner", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body %s", w.Code, w.Body)
	}
	var d app.Delivery
	if err := json.Unmarshal(w.Body.Bytes(), &d); err != nil {
		t.Fatalf("响应应为 Delivery: %v", err)
	}
	if d.ID != "dlv-new" || d.EventID != "evt-1" || d.Status != app.StatusPending {
		t.Errorf("应返回新投递行, got %+v", d)
	}

	w = do(mux, http.MethodPost, "/api/workspaces/"+testWS+"/webhooks/deliveries/dlv-x/redeliver", "u-owner", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("未知投递 status = %d, want 404", w.Code)
	}
}

func TestRoutesRotateSecret_WH13(t *testing.T) {
	repo, mux := newTestMux(t)
	base := "/api/workspaces/" + testWS + "/webhooks/subscriptions/sub-1/rotate-secret"

	if w := do(mux, http.MethodPost, base, "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("未认证 status = %d, want 401", w.Code)
	}

	if w := do(mux, http.MethodPost, base, "u-member", ""); w.Code != http.StatusForbidden {
		t.Fatalf("member status = %d, want 403", w.Code)
	}

	w := do(mux, http.MethodPost, base, "u-owner", "")
	if w.Code != http.StatusOK {
		t.Fatalf("owner status = %d, want 200, body %s", w.Code, w.Body)
	}
	var out struct {
		Secret string `json:"secret"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("响应应为 {secret}: %v", err)
	}
	if len(out.Secret) != 68 || out.Secret[:4] != "whk_" {
		t.Errorf("应返回明文新钥（whk_+64hex）, got %q", out.Secret)
	}
	if repo.rotateSub != "sub-1" {
		t.Errorf("repo 应收到轮换, got %q", repo.rotateSub)
	}

	w = do(mux, http.MethodPost, "/api/workspaces/"+testWS+"/webhooks/subscriptions/sub-x/rotate-secret", "u-owner", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("未知订阅 status = %d, want 404, body %s", w.Code, w.Body)
	}
	var eb webx.ErrorBody
	if err := json.Unmarshal(w.Body.Bytes(), &eb); err != nil || eb.Code != "E_NOT_FOUND" {
		t.Errorf("错误信封应含 E_NOT_FOUND, got %s err=%v", w.Body, err)
	}
}

func TestRoutesCreateSubscription_Validation400_API_FT2_5(t *testing.T) {
	_, mux := newTestMux(t)
	base := "/api/workspaces/" + testWS + "/webhooks/subscriptions"

	cases := []struct {
		name     string
		userID   string
		body     string
		wantCode int
	}{
		{"member 403", "u-member", `{"url":"https://example.com/h","events":["task.created"]}`, http.StatusForbidden},
		{"未知事件名 400（此前 500）", "u-owner", `{"url":"https://example.com/h","events":["nope.event"]}`, http.StatusBadRequest},
		{"ftp scheme 400", "u-owner", `{"url":"ftp://example.com/h","events":["task.created"]}`, http.StatusBadRequest},
		{"javascript scheme 400", "u-owner", `{"url":"javascript:alert(1)","events":["task.created"]}`, http.StatusBadRequest},
		{"私网目标 400（开关默认关）", "u-owner", `{"url":"http://127.0.0.1:8030/readyz","events":["task.created"]}`, http.StatusBadRequest},
		{"缺字段 400", "u-owner", `{"url":"https://example.com/h"}`, http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := do(mux, http.MethodPost, base, c.userID, c.body)
			if w.Code != c.wantCode {
				t.Fatalf("status = %d, want %d, body %s", w.Code, c.wantCode, w.Body)
			}
			if c.wantCode == http.StatusBadRequest {
				var eb webx.ErrorBody
				if err := json.Unmarshal(w.Body.Bytes(), &eb); err != nil || eb.Code != "E_VALIDATION" {
					t.Errorf("错误信封应含 E_VALIDATION, got %s err=%v", w.Body, err)
				}
			}
		})
	}
}

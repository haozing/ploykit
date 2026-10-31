package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

// cancelStubRepo embeds the Repo interface so only the methods the cancel
// paths touch need faking (unimplemented calls panic loudly).
type cancelStubRepo struct {
	app.Repo

	wsExists   map[string]bool
	wsPlan     map[string]string
	wsSubRef   map[string]string
	wsCancel   map[string]time.Time
	wsRenew    map[string]time.Time
	setCancel  []string
	paidOrders []domain.Order
}

func newCancelStubRepo() *cancelStubRepo {
	return &cancelStubRepo{
		wsExists: map[string]bool{},
		wsPlan:   map[string]string{},
		wsSubRef: map[string]string{},
		wsCancel: map[string]time.Time{},
		wsRenew:  map[string]time.Time{},
	}
}

func (r *cancelStubRepo) GetWorkspaceSubscription(_ context.Context, ws string) (string, bool, error) {
	if !r.wsExists[ws] {
		return "", false, nil
	}
	return r.wsSubRef[ws], true, nil
}

func (r *cancelStubRepo) GetWorkspacePlan(_ context.Context, ws string) (string, error) {
	if p, ok := r.wsPlan[ws]; ok {
		return p, nil
	}
	return "free", nil
}

func (r *cancelStubRepo) GetWorkspaceCancelRequested(_ context.Context, ws string) (time.Time, bool, error) {
	at, ok := r.wsCancel[ws]
	return at, ok, nil
}

// GetWorkspacePlanExpiry mirrors the pgrepo read (R5): the paid period end.
func (r *cancelStubRepo) GetWorkspacePlanExpiry(_ context.Context, ws string) (time.Time, bool, error) {
	at, ok := r.wsRenew[ws]
	if !ok || at.IsZero() {
		return time.Time{}, false, nil
	}
	return at, true, nil
}

func (r *cancelStubRepo) SetWorkspaceCancelRequested(_ context.Context, ws string, now time.Time) error {
	r.setCancel = append(r.setCancel, ws)
	r.wsCancel[ws] = now
	return nil
}

func (r *cancelStubRepo) ListOrdersByWorkspace(_ context.Context, _ string, _ int) ([]domain.Order, error) {
	return r.paidOrders, nil
}

func (r *cancelStubRepo) ListCancelRequestedWorkspaces(_ context.Context, limit int) ([]app.CancelRequestView, error) {
	out := []app.CancelRequestView{}
	for ws, at := range r.wsCancel {
		out = append(out, app.CancelRequestView{
			WorkspaceID: ws, RequestedAt: at, PlanCode: r.wsPlan[ws], SubscriptionRef: r.wsSubRef[ws],
		})
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// fakeCancellerChannel drives the channel-through branch hermetically.
type fakeCancellerChannel struct {
	name   string
	timing app.CancelTiming
	calls  []string
}

func (c *fakeCancellerChannel) Name() string { return c.name }
func (c *fakeCancellerChannel) CreateCheckout(context.Context, app.CheckoutRequest) (domain.CheckoutSession, error) {
	return domain.CheckoutSession{}, nil
}
func (c *fakeCancellerChannel) ParseWebhook(context.Context, app.WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, nil
}
func (c *fakeCancellerChannel) CancelSubscription(_ context.Context, subID string) error {
	c.calls = append(c.calls, subID)
	return nil
}
func (c *fakeCancellerChannel) Capabilities() app.ChannelCaps {
	return app.ChannelCaps{CancelTiming: c.timing}
}

// plainHTTPChannel implements the PaymentChannel core only — no canceller.
// None of the built-in channels has this shape anymore (2026-10-26
// correction: stripe implements SubscriptionCanceller since v0.15.0); the
// branch stays for third-party channels without a canceller API.
type plainHTTPChannel struct{ name string }

func (c plainHTTPChannel) Name() string { return c.name }
func (c plainHTTPChannel) CreateCheckout(context.Context, app.CheckoutRequest) (domain.CheckoutSession, error) {
	return domain.CheckoutSession{}, nil
}
func (c plainHTTPChannel) ParseWebhook(context.Context, app.WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, nil
}

func cancelMux(t *testing.T, svc *app.BillingService, wsMW func(http.Handler) http.Handler) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	Mount(mux, Deps{Svc: svc, WsMW: wsMW, Authz: authz.New(nil, nil)})
	return mux
}

func doCancel(t *testing.T, mux *http.ServeMux, p *webx.Principal) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/api/billing/subscription/cancel", nil)
	if p != nil {
		r = r.WithContext(webx.WithPrincipal(r.Context(), p))
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestUserCancelRoute(t *testing.T) {
	t.Run("未认证 → 401", func(t *testing.T) {
		w := doCancel(t, cancelMux(t, nil, withPrincipal(nil)), nil)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("无工作区上下文 → 403（guard 先拦）", func(t *testing.T) {
		mux := cancelMux(t, nil, withPrincipal(&webx.Principal{UserID: "alice"}))
		w := doCancel(t, mux, &webx.Principal{UserID: "alice"})
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("受理 operator_pending → 200 + outcome（不是 4xx：用户操作被受理）", func(t *testing.T) {
		repo := newCancelStubRepo()
		repo.wsExists["ws-1"] = true
		repo.wsPlan["ws-1"] = "pro"
		repo.wsSubRef["ws-1"] = "sub_1"
		repo.paidOrders = []domain.Order{{
			ID: "o1", WorkspaceID: "ws-1", Status: domain.OrderPaid,
			Interval: domain.IntervalMonthly, Channel: "mno-x",
		}}
		// A third-party channel without a canceller API (all three built-in
		// channels implement SubscriptionCanceller — including stripe, per the
		// 2026-10-26 audit correction): the request is still ACCEPTED, it just
		// lands in the operator queue.
		reg := app.NewChannelRegistry()
		reg.Register(plainHTTPChannel{name: "mno-x"})
		svc := app.NewBillingService(repo, reg, app.Config{}, app.BillingHooks{}, nil,
			func() time.Time { return time.Now().UTC() }, nil)
		member := &webx.Principal{UserID: "alice", WorkspaceID: "ws-1", Role: "admin"}
		mux := cancelMux(t, svc, withPrincipal(member))

		w := doCancel(t, mux, member)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		var body struct {
			Ok      bool   `json:"ok"`
			Outcome string `json:"outcome"`
		}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		assert.True(t, body.Ok)
		assert.Equal(t, "operator_pending", body.Outcome)
	})

	t.Run("受理 period_end → 200 + outcome=period_end", func(t *testing.T) {
		repo := newCancelStubRepo()
		repo.wsExists["ws-1"] = true
		repo.wsPlan["ws-1"] = "pro"
		repo.wsSubRef["ws-1"] = "sub_1"
		repo.paidOrders = []domain.Order{{
			ID: "o1", WorkspaceID: "ws-1", Status: domain.OrderPaid,
			Interval: domain.IntervalMonthly, Channel: "waffo",
		}}
		ch := &fakeCancellerChannel{name: "waffo", timing: app.CancelTimingPeriodEnd}
		reg := app.NewChannelRegistry()
		reg.Register(ch)
		svc := app.NewBillingService(repo, reg, app.Config{}, app.BillingHooks{}, nil,
			func() time.Time { return time.Now().UTC() }, nil)
		member := &webx.Principal{UserID: "alice", WorkspaceID: "ws-1", Role: "admin"}
		mux := cancelMux(t, svc, withPrincipal(member))

		w := doCancel(t, mux, member)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		var body struct {
			Ok      bool   `json:"ok"`
			Outcome string `json:"outcome"`
		}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		assert.True(t, body.Ok)
		assert.Equal(t, "period_end", body.Outcome)
		assert.Equal(t, []string{"sub_1"}, ch.calls)
	})
}

func TestAdminCancelRequestsRoute(t *testing.T) {
	guard := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Admin") != "1" {
				webx.ErrForbidden(w, "platform admin required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
	repo := newCancelStubRepo()
	repo.wsExists["ws-1"] = true
	repo.wsPlan["ws-1"] = "pro"
	repo.wsSubRef["ws-1"] = "sub_1"
	repo.wsCancel["ws-1"] = time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	svc := app.NewBillingService(repo, app.NewChannelRegistry(), app.Config{}, app.BillingHooks{}, nil,
		func() time.Time { return time.Now().UTC() }, nil)

	mux := http.NewServeMux()
	MountAdmin(mux, AdminDeps{Svc: svc, Guard: guard})

	t.Run("无守卫凭据 → 403", func(t *testing.T) {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/admin/billing/cancel-requests", nil))
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("守卫通过 → 队列行（workspace_id/requested_at/plan/subscription_ref）", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/api/admin/billing/cancel-requests", nil)
		r.Header.Set("X-Admin", "1")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		var body struct {
			Items []app.CancelRequestView `json:"items"`
		}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		require.Len(t, body.Items, 1)
		assert.Equal(t, "ws-1", body.Items[0].WorkspaceID)
		assert.Equal(t, "pro", body.Items[0].PlanCode)
		assert.Equal(t, "sub_1", body.Items[0].SubscriptionRef)
		assert.True(t, body.Items[0].RequestedAt.Equal(time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)))
	})

	t.Run("Guard 缺失 → panic（不静默裸奔）", func(t *testing.T) {
		assert.Panics(t, func() {
			MountAdmin(http.NewServeMux(), AdminDeps{Svc: svc})
		})
	})
}

// ---- R5: GET /api/billing/subscription 携带取消状态三字段 ----

func doGetSubscription(t *testing.T, mux *http.ServeMux, p *webx.Principal) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/billing/subscription", nil)
	if p != nil {
		r = r.WithContext(webx.WithPrincipal(r.Context(), p))
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestGetSubscriptionCancelFields(t *testing.T) {
	t.Run("待处理取消 + period_end 渠道 → 三字段齐、plan/orders 原样", func(t *testing.T) {
		repo := newCancelStubRepo()
		repo.wsExists["ws-1"] = true
		repo.wsPlan["ws-1"] = "pro"
		repo.wsSubRef["ws-1"] = "sub_1"
		repo.wsCancel["ws-1"] = time.Date(2026, 10, 25, 1, 2, 3, 0, time.UTC)
		repo.wsRenew["ws-1"] = time.Date(2026, 11, 25, 0, 0, 0, 0, time.UTC)
		repo.paidOrders = []domain.Order{{
			ID: "o1", WorkspaceID: "ws-1", Status: domain.OrderPaid,
			Interval: domain.IntervalMonthly, Channel: "waffo",
		}}
		ch := &fakeCancellerChannel{name: "waffo", timing: app.CancelTimingPeriodEnd}
		reg := app.NewChannelRegistry()
		reg.Register(ch)
		svc := app.NewBillingService(repo, reg, app.Config{}, app.BillingHooks{}, nil,
			func() time.Time { return time.Now().UTC() }, nil)
		member := &webx.Principal{UserID: "alice", WorkspaceID: "ws-1", Role: "admin"}
		mux := cancelMux(t, svc, withPrincipal(member))

		w := doGetSubscription(t, mux, member)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		var body struct {
			PlanCode          string            `json:"plan_code"`
			CancelRequestedAt *time.Time        `json:"cancel_requested_at"`
			RenewsAt          *time.Time        `json:"renews_at"`
			CancelTiming      *app.CancelTiming `json:"cancel_timing"`
		}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		assert.Equal(t, "pro", body.PlanCode)
		require.NotNil(t, body.CancelRequestedAt)
		assert.Equal(t, "2026-10-25T01:02:03Z", body.CancelRequestedAt.UTC().Format(time.RFC3339))
		require.NotNil(t, body.RenewsAt)
		assert.Equal(t, "2026-11-25T00:00:00Z", body.RenewsAt.UTC().Format(time.RFC3339))
		require.NotNil(t, body.CancelTiming)
		assert.Equal(t, app.CancelTimingPeriodEnd, *body.CancelTiming)
	})

	t.Run("409-free：free 工作区无订阅 → 200 + 三字段 null（不炸）", func(t *testing.T) {
		repo := newCancelStubRepo()
		repo.wsExists["ws-free"] = true
		repo.wsPlan["ws-free"] = "free"
		svc := app.NewBillingService(repo, app.NewChannelRegistry(), app.Config{}, app.BillingHooks{}, nil,
			func() time.Time { return time.Now().UTC() }, nil)
		member := &webx.Principal{UserID: "alice", WorkspaceID: "ws-free", Role: "admin"}
		mux := cancelMux(t, svc, withPrincipal(member))

		w := doGetSubscription(t, mux, member)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		var body struct {
			PlanCode          string            `json:"plan_code"`
			CancelRequestedAt *time.Time        `json:"cancel_requested_at"`
			RenewsAt          *time.Time        `json:"renews_at"`
			CancelTiming      *app.CancelTiming `json:"cancel_timing"`
		}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
		assert.Equal(t, "free", body.PlanCode)
		assert.Nil(t, body.CancelRequestedAt)
		assert.Nil(t, body.RenewsAt)
		assert.Nil(t, body.CancelTiming)
	})
}

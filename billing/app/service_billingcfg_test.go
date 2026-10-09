package app

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type cfgRepo struct {
	*fakeRepo
	orders []domain.Order
}

func (f *cfgRepo) ListOrdersByWorkspace(_ context.Context, wsID string, limit int) ([]domain.Order, error) {
	out := []domain.Order{}
	for _, o := range f.orders {
		if o.WorkspaceID == wsID {
			out = append(out, o)
		}
	}

	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

type cfgChannel struct {
	name        string
	configured  bool
	webhookOn   bool
	testErr     error
	cancelErr   error
	cancelCalls []string
}

func (c *cfgChannel) Name() string { return c.name }

func (c *cfgChannel) CreateCheckout(_ context.Context, _ domain.Order, _, _ string) (domain.CheckoutSession, error) {
	return domain.CheckoutSession{}, nil
}

func (c *cfgChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, nil
}

func (c *cfgChannel) ChannelConfig() ChannelConfigInfo {
	if !c.configured {
		return ChannelConfigInfo{}
	}
	return ChannelConfigInfo{Configured: true, KeyMasked: "sk_test_***key1", WebhookConfigured: c.webhookOn}
}

func (c *cfgChannel) TestConnection(_ context.Context) error { return c.testErr }

func (c *cfgChannel) CancelSubscription(_ context.Context, providerSubID string) error {
	c.cancelCalls = append(c.cancelCalls, providerSubID)
	return c.cancelErr
}

type plainChannel struct{ name string }

func (c *plainChannel) Name() string { return c.name }

func (c *plainChannel) CreateCheckout(_ context.Context, _ domain.Order, _, _ string) (domain.CheckoutSession, error) {
	return domain.CheckoutSession{}, nil
}

func (c *plainChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, nil
}

func TestBillingConfig_ViewAssembly(t *testing.T) {
	reg := NewChannelRegistry()
	reg.Register(&cfgChannel{name: "stripe", configured: true, webhookOn: true})
	reg.Register(&cfgChannel{name: "zpay", configured: false})
	reg.Register(&plainChannel{name: "plainchan"})
	svc := NewBillingService(newFakeRepo(), reg, Config{}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)

	view := svc.BillingConfig(context.Background())

	require.Len(t, view.Channels, 3)
	assert.Equal(t, "plainchan", view.Channels[0].Name)
	assert.Equal(t, "stripe", view.Channels[1].Name)
	assert.Equal(t, "zpay", view.Channels[2].Name)

	assert.True(t, view.Channels[1].Configured)
	assert.Equal(t, "sk_test_***key1", view.Channels[1].KeyMasked)
	assert.True(t, view.Channels[1].WebhookConfigured)

	assert.False(t, view.Channels[2].Configured)
	assert.Equal(t, "未配置", view.Channels[2].KeyMasked)
	assert.False(t, view.Channels[2].WebhookConfigured)

	assert.True(t, view.Channels[0].Configured)
	assert.Equal(t, "—", view.Channels[0].KeyMasked)
}

func TestBillingConfig_UnregisteredBuiltinShowsNotConfigured(t *testing.T) {

	svc := NewBillingService(newFakeRepo(), NewChannelRegistry(), Config{}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil)

	view := svc.BillingConfig(context.Background())
	require.Len(t, view.Channels, 1)
	assert.Equal(t, ChannelConfigView{Name: "stripe", Configured: false, KeyMasked: "未配置"}, view.Channels[0])
}

func TestTestChannelConnection(t *testing.T) {
	tests := []struct {
		name     string
		register func(*ChannelRegistry) (string, error)
		wantCode string
		wantMsg  string
	}{
		{
			name: "已配置且 provider 可达 → nil",
			register: func(r *ChannelRegistry) (string, error) {
				r.Register(&cfgChannel{name: "ok", configured: true})
				return "ok", nil
			},
		},
		{
			name: "未配置密钥 → 400 E_CHANNEL_NOT_CONFIGURED（文案：渠道未配置密钥）",
			register: func(r *ChannelRegistry) (string, error) {
				r.Register(&cfgChannel{name: "nokey", configured: false})
				return "nokey", nil
			},
			wantCode: CodeChannelNotConfigured,
			wantMsg:  "渠道未配置密钥",
		},
		{
			name: "渠道未实现 ConnectionTester → 400 E_CHANNEL_TEST_UNSUPPORTED",
			register: func(r *ChannelRegistry) (string, error) {
				r.Register(&plainChannel{name: "plain"})
				return "plain", nil
			},
			wantCode: CodeChannelTestUnsupported,
		},
		{
			name: "provider 探活失败 → 错误透传",
			register: func(r *ChannelRegistry) (string, error) {
				r.Register(&cfgChannel{name: "bad", configured: true, testErr: assert.AnError})
				return "bad", assert.AnError
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reg := NewChannelRegistry()
			channelName, wantErr := tt.register(reg)
			svc := NewBillingService(newFakeRepo(), reg, Config{}, BillingHooks{}, nil,
				func() time.Time { return testNow }, nil)

			err := svc.TestChannelConnection(context.Background(), channelName)
			if wantErr == nil && tt.wantCode == "" {
				require.NoError(t, err)
				return
			}
			if wantErr != nil {

				require.ErrorIs(t, err, wantErr)
				return
			}
			var we *webx.Error
			require.ErrorAs(t, err, &we)
			if tt.wantCode != "" {
				assert.Equal(t, tt.wantCode, we.Code)
				assert.Equal(t, http.StatusBadRequest, we.Status)
			}
			if tt.wantMsg != "" {
				assert.Equal(t, tt.wantMsg, we.Message)
			}
		})
	}

	t.Run("未知渠道 → 404", func(t *testing.T) {
		svc := NewBillingService(newFakeRepo(), NewChannelRegistry(), Config{}, BillingHooks{}, nil,
			func() time.Time { return testNow }, nil)
		err := svc.TestChannelConnection(context.Background(), "ghost")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusNotFound, we.Status)
	})
}

func newCancelSvc(repo *cfgRepo, channels ...PaymentChannel) (*BillingService, *fakeAuditor, *hookTrace) {
	reg := NewChannelRegistry()
	for _, ch := range channels {
		reg.Register(ch)
	}
	aud := &fakeAuditor{}
	hooks := &hookTrace{}
	svc := NewBillingService(repo, reg, Config{}, BillingHooks{
		OnPlanChanged: func(_ context.Context, ws, from, to string) error {
			hooks.planChanged = append(hooks.planChanged, [3]string{ws, from, to})
			return nil
		},
	}, aud, func() time.Time { return testNow }, nil)
	return svc, aud, hooks
}

func subFixture(repo *cfgRepo, chName string, wsID string) {
	repo.wsExists[wsID] = true
	repo.wsPlan[wsID] = "pro"
	repo.wsSub[wsID] = subState{ref: "sub_1", expiresAt: testNow.AddDate(0, 1, 0)}
	repo.bySub["sub_1"] = wsID
	repo.orders = append(repo.orders, domain.Order{
		ID: "ord_" + wsID, WorkspaceID: wsID, PlanCode: "pro",
		Interval: domain.IntervalMonthly, Status: domain.OrderPaid, Channel: chName,
		CreatedAt: testNow.Add(-24 * time.Hour),
	})
}

func TestAdminCancelSubscription_ProviderFirst(t *testing.T) {
	t.Run("provider 取消成功 → 本地降级 + 留痕 + 审计", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		ch := &cfgChannel{name: "stripe", configured: true}
		subFixture(repo, "stripe", "ws_1")
		svc, aud, hooks := newCancelSvc(repo, ch)

		require.NoError(t, svc.AdminCancelSubscription(context.Background(), principal(), "ws_1"))

		assert.Equal(t, []string{"sub_1"}, ch.cancelCalls)

		require.Len(t, repo.changePlans, 1)
		assert.Equal(t, changePlanCall{ws: "ws_1", to: "free", actor: "admin:usr_1", reason: "admin cancel"}, repo.changePlans[0])
		require.Len(t, repo.setSubs, 1)
		assert.Equal(t, setSubCall{ws: "ws_1", ref: ""}, repo.setSubs[0])
		assert.Equal(t, "free", repo.wsPlan["ws_1"])
		assert.Equal(t, [][3]string{{"ws_1", "pro", "free"}}, hooks.planChanged)

		require.Len(t, aud.calls, 1)
		assert.Equal(t, "billing.subscription_canceled", aud.calls[0].action)
		assert.Equal(t, "workspace", aud.calls[0].resourceType)
		assert.Equal(t, "ws_1", aud.calls[0].resourceID)
		assert.Equal(t, map[string]any{"admin": true, "subscription_ref": "sub_1"}, aud.calls[0].meta)
		assert.NotNil(t, aud.calls[0].p)
		assert.Equal(t, "usr_1", aud.calls[0].p.UserID)
	})

	t.Run("provider 取消失败 → 返回错误且不降级", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		ch := &cfgChannel{name: "stripe", configured: true, cancelErr: assert.AnError}
		subFixture(repo, "stripe", "ws_2")
		svc, aud, _ := newCancelSvc(repo, ch)

		err := svc.AdminCancelSubscription(context.Background(), principal(), "ws_2")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadGateway, we.Status)
		assert.Contains(t, we.Message, "取消渠道订阅失败")

		assert.Empty(t, repo.changePlans)
		assert.Empty(t, repo.setSubs)
		assert.Equal(t, "pro", repo.wsPlan["ws_2"])
		assert.Empty(t, aud.calls)
	})

	t.Run("无 provider 订阅（手动套餐）→ 仅本地降级", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		repo.wsExists["ws_3"] = true
		repo.wsPlan["ws_3"] = "pro"
		ch := &cfgChannel{name: "stripe", configured: true}
		svc, _, _ := newCancelSvc(repo, ch)

		require.NoError(t, svc.AdminCancelSubscription(context.Background(), principal(), "ws_3"))
		assert.Empty(t, ch.cancelCalls, "无订阅号不得调 provider")
		require.Len(t, repo.changePlans, 1)
		assert.Equal(t, "free", repo.wsPlan["ws_3"])
	})

	t.Run("已是 free 且无订阅 → 409", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		repo.wsExists["ws_4"] = true
		repo.wsPlan["ws_4"] = "free"
		svc, _, _ := newCancelSvc(repo)

		err := svc.AdminCancelSubscription(context.Background(), principal(), "ws_4")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusConflict, we.Status)
		assert.Empty(t, repo.changePlans)
	})

	t.Run("工作区不存在 → 404", func(t *testing.T) {
		svc, _, _ := newCancelSvc(&cfgRepo{fakeRepo: newFakeRepo()})
		err := svc.AdminCancelSubscription(context.Background(), principal(), "ws_ghost")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusNotFound, we.Status)
	})

	t.Run("渠道未实现 SubscriptionCanceller → 400 且不降级", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		subFixture(repo, "plain", "ws_5")
		svc, aud, _ := newCancelSvc(repo, &plainChannel{name: "plain"})

		err := svc.AdminCancelSubscription(context.Background(), principal(), "ws_5")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadRequest, we.Status)
		assert.Equal(t, CodeChannelCancelUnsupported, we.Code)
		assert.Empty(t, repo.changePlans)
		assert.Empty(t, aud.calls)
	})

	t.Run("订阅渠道不在注册表（运行时摘除）→ 400 且不降级", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		subFixture(repo, "gonechan", "ws_6")
		svc, _, _ := newCancelSvc(repo)

		err := svc.AdminCancelSubscription(context.Background(), principal(), "ws_6")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, CodeChannelCancelUnsupported, we.Code)
		assert.Empty(t, repo.changePlans)
	})

	t.Run("渠道定位取最新 paid 周期性订单（跳过 one_time/超额与 failed）", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		repo.wsExists["ws_7"] = true
		repo.wsPlan["ws_7"] = "pro"
		repo.wsSub["ws_7"] = subState{ref: "sub_7"}
		repo.bySub["sub_7"] = "ws_7"
		repo.orders = []domain.Order{
			{ID: "o1", WorkspaceID: "ws_7", Status: domain.OrderPaid, Channel: "oldchan", Interval: domain.IntervalMonthly, CreatedAt: testNow.Add(-72 * time.Hour)},
			{ID: "o2", WorkspaceID: "ws_7", Status: domain.OrderFailed, Channel: "newchan", Interval: domain.IntervalMonthly, CreatedAt: testNow.Add(-48 * time.Hour)},
			{ID: "o3", WorkspaceID: "ws_7", Status: domain.OrderPaid, Channel: "manual", Interval: domain.IntervalOneTime, CreatedAt: testNow.Add(-24 * time.Hour)},
			{ID: "o4", WorkspaceID: "ws_7", Status: domain.OrderPaid, Channel: "newchan", Interval: domain.IntervalYearly, CreatedAt: testNow.Add(-12 * time.Hour)},
		}
		newch := &cfgChannel{name: "newchan", configured: true}
		svc, _, _ := newCancelSvc(repo, newch)

		require.NoError(t, svc.AdminCancelSubscription(context.Background(), principal(), "ws_7"))
		assert.Equal(t, []string{"sub_7"}, newch.cancelCalls, "应命中最新 paid 周期性订单的渠道 newchan")
	})
}

func TestAdminCancelSubscription_Delegation(t *testing.T) {
	repo := &cfgRepo{fakeRepo: newFakeRepo()}
	ch := &cfgChannel{name: "stripe", configured: true}
	subFixture(repo, "stripe", "ws_1")
	svc, _, _ := newCancelSvc(repo, ch)
	adminSvc := NewBillingAdminService(svc, nil, nil, nil)

	require.NoError(t, adminSvc.TestChannelConnection(context.Background(), "stripe"))
	require.NoError(t, adminSvc.AdminCancelSubscription(context.Background(), principal(), "ws_1"))
	assert.Equal(t, []string{"sub_1"}, ch.cancelCalls)
	_, err := adminSvc.BillingConfig(context.Background())
	require.NoError(t, err)
}

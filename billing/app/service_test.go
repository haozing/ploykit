package app

import (
	"context"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type setSubCall struct {
	ws, ref   string
	expiresAt time.Time
}

type changePlanCall struct {
	ws, to, actor, reason string
}

type channelRefCall struct {
	id        string
	ref       string
	expiresAt time.Time
}

type subState struct {
	ref       string
	expiresAt time.Time
}

type fakeRepo struct {
	plans       map[string]domain.Plan
	orders      map[string]*domain.Order
	byRef       map[string]string
	byPI        map[string]string
	piAnchor    []string
	events      map[string]string
	processed   map[string]bool
	eventErrors map[string]string
	wsPlan      map[string]string
	wsSub       map[string]subState
	wsExists    map[string]bool
	bySub       map[string]string

	// LC-4 cancel_requested_at bookkeeping (migration 053): per-workspace
	// mark plus the call traces the user-cancel tests assert on.
	wsCancelReq     map[string]time.Time
	setCancelReqs   []string
	clearCancelReqs []string
	paidIv      map[string]domain.BillingInterval
	setSubs     []setSubCall
	changePlans []changePlanCall
	expired     []ExpiredWorkspace
	staleOrders []ExpiredOrder

	// canceledBy mirrors migrations/051's order.canceled_by (domain.Order 不扩字段，fake 内部记账).
	canceledBy map[string]string

	channelRefCalls []channelRefCall

	updateStatusErr error
	getOrderErr     error
	changePlanErr   error
	findSubErr      error

	overageIndex map[string]bool
	overageCalls []overageCall
	metered      []MeteredWorkspace

	meters map[string]Meter

	// BC-7 catalog mapping: key = channel+"/"+planCode+"/"+interval.
	chanProducts   map[string]domain.ChannelProduct
	chanUpserts    []domain.ChannelProduct
	chanProductErr error
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		plans:        map[string]domain.Plan{},
		orders:       map[string]*domain.Order{},
		byRef:        map[string]string{},
		byPI:         map[string]string{},
		events:       map[string]string{},
		processed:    map[string]bool{},
		eventErrors:  map[string]string{},
		wsPlan:       map[string]string{},
		wsSub:        map[string]subState{},
		wsExists:     map[string]bool{},
		bySub:        map[string]string{},
		wsCancelReq:  map[string]time.Time{},
		paidIv:       map[string]domain.BillingInterval{},
		overageIndex: map[string]bool{},
		meters:       map[string]Meter{},
	}
}

func (f *fakeRepo) CreateOrder(_ context.Context, o domain.Order) (domain.Order, error) {
	o.ID = "ord_" + o.PlanCode
	f.orders[o.ID] = &o
	return o, nil
}

func (f *fakeRepo) GetOrder(_ context.Context, id string) (domain.Order, bool, error) {
	if f.getOrderErr != nil {
		return domain.Order{}, false, f.getOrderErr
	}
	o, ok := f.orders[id]
	if !ok {
		return domain.Order{}, false, nil
	}
	return *o, true, nil
}

func (f *fakeRepo) ListOrdersByWorkspace(_ context.Context, _ string, _ int) ([]domain.Order, error) {
	return nil, nil
}

func (f *fakeRepo) UpdateOrderStatus(_ context.Context, id string, from, to domain.OrderStatus, now time.Time) error {
	if f.updateStatusErr != nil {
		return f.updateStatusErr
	}
	o, ok := f.orders[id]
	if !ok || o.Status != from {
		return domain.ErrStatusConflict
	}
	o.Status = to
	if to == domain.OrderPaid {
		t := now
		o.PaidAt = &t
	}
	return nil
}

func (f *fakeRepo) CancelOrder(_ context.Context, id string, from domain.OrderStatus, canceledBy string, now time.Time) error {
	if f.updateStatusErr != nil {
		return f.updateStatusErr
	}
	o, ok := f.orders[id]
	if !ok || o.Status != from {
		return domain.ErrStatusConflict
	}
	o.Status = domain.OrderCanceled
	t := now
	o.CanceledAt = &t
	if f.canceledBy == nil {
		f.canceledBy = map[string]string{}
	}
	f.canceledBy[id] = canceledBy
	return nil
}

func (f *fakeRepo) ReviveOrderAfterExpiry(_ context.Context, id string, now time.Time) (bool, error) {
	o, ok := f.orders[id]
	if !ok || o.Status != domain.OrderCanceled || f.canceledBy[id] != "expiry" {
		return false, nil
	}
	o.Status = domain.OrderPaid
	t := now
	o.PaidAt = &t
	delete(f.canceledBy, id)
	return true, nil
}

func (f *fakeRepo) SetOrderChannelRefAndExpiry(_ context.Context, id, ref string, expiresAt time.Time) error {
	if o, ok := f.orders[id]; ok {
		o.ChannelRef = ref
	}
	f.channelRefCalls = append(f.channelRefCalls, channelRefCall{id: id, ref: ref, expiresAt: expiresAt})
	return nil
}

func (f *fakeRepo) FailOrder(_ context.Context, o domain.Order, e domain.PaymentEvent, emit func(pgx.Tx) error, now time.Time) error {
	if f.updateStatusErr != nil {
		return f.updateStatusErr
	}
	ord, ok := f.orders[o.ID]
	if !ok || ord.Status != domain.OrderPending {
		return domain.ErrStatusConflict
	}
	ord.Status = domain.OrderFailed
	if emit != nil {
		if err := emit(nil); err != nil {
			ord.Status = domain.OrderPending
			return err
		}
	}
	key := e.Channel + ":" + e.ChannelEventID
	f.processed[key] = true
	f.events[key] = "processed"
	return nil
}

func (f *fakeRepo) PayOrder(_ context.Context, id string, emit func(pgx.Tx) error, now time.Time) error {
	if f.updateStatusErr != nil {
		return f.updateStatusErr
	}
	ord, ok := f.orders[id]
	if !ok || ord.Status != domain.OrderPending {
		return domain.ErrStatusConflict
	}
	ord.Status = domain.OrderPaid
	t := now
	ord.PaidAt = &t
	if emit != nil {
		if err := emit(nil); err != nil {
			ord.Status = domain.OrderPending
			ord.PaidAt = nil
			return err
		}
	}
	return nil
}

func (f *fakeRepo) FindOrderByChannelRef(_ context.Context, channel, ref string) (domain.Order, bool, error) {

	id, ok := f.byRef[channel+":"+ref]
	if !ok {
		return domain.Order{}, false, nil
	}
	return *f.orders[id], true, nil
}

func (f *fakeRepo) SetOrderPaymentIntentRef(_ context.Context, orderID, pi string) error {
	f.piAnchor = append(f.piAnchor, orderID)
	if o, ok := f.orders[orderID]; ok {
		if o.Metadata == nil {
			o.Metadata = map[string]any{}
		}
		o.Metadata["payment_intent"] = pi
	}
	f.byPI[pi] = orderID
	return nil
}

func (f *fakeRepo) FindOrderByPaymentIntent(_ context.Context, pi string) (domain.Order, bool, error) {
	id, ok := f.byPI[pi]
	if !ok {
		return domain.Order{}, false, nil
	}
	return *f.orders[id], true, nil
}

func (f *fakeRepo) InsertPaymentEvent(_ context.Context, e domain.PaymentEvent) (bool, error) {
	key := e.Channel + ":" + e.ChannelEventID
	switch f.events[key] {
	case "":
		f.events[key] = "received"
		return true, nil
	case "error":
		f.events[key] = "received"
		return true, nil
	default:
		return false, nil
	}
}

func (f *fakeRepo) MarkEventProcessed(_ context.Context, channel, eventID string) error {
	key := channel + ":" + eventID
	f.processed[key] = true
	f.events[key] = "processed"
	return nil
}

func (f *fakeRepo) MarkEventError(_ context.Context, channel, eventID, processErr string) error {
	key := channel + ":" + eventID
	f.eventErrors[key] = processErr
	f.events[key] = "error"
	return nil
}

func (f *fakeRepo) ListPlans(_ context.Context) ([]domain.Plan, error) { return nil, nil }

func (f *fakeRepo) GetPlan(_ context.Context, code string) (domain.Plan, bool, error) {
	p, ok := f.plans[code]
	return p, ok, nil
}

func (f *fakeRepo) ChangeWorkspacePlan(_ context.Context, ws, to, actor, reason string, _ time.Time, inTx func(pgx.Tx, string) error) error {
	if f.changePlanErr != nil {
		return f.changePlanErr
	}
	var from string
	if p, ok := f.wsPlan[ws]; ok {
		from = p
	}

	if inTx != nil {
		if err := inTx(nil, from); err != nil {
			return err
		}
	}
	f.changePlans = append(f.changePlans, changePlanCall{ws: ws, to: to, actor: actor, reason: reason})
	f.wsPlan[ws] = to
	return nil
}

func (f *fakeRepo) GetWorkspacePlan(_ context.Context, ws string) (string, error) {
	if p, ok := f.wsPlan[ws]; ok {
		return p, nil
	}
	return "free", nil
}

func (f *fakeRepo) SetWorkspaceSubscription(_ context.Context, ws, ref string, expiresAt, _ time.Time) error {
	f.setSubs = append(f.setSubs, setSubCall{ws: ws, ref: ref, expiresAt: expiresAt})

	if old, ok := f.wsSub[ws]; ok && old.ref != "" {
		delete(f.bySub, old.ref)
	}
	if ref == "" {
		delete(f.wsSub, ws)
		return nil
	}
	f.wsSub[ws] = subState{ref: ref, expiresAt: expiresAt}
	f.bySub[ref] = ws
	return nil
}

func (f *fakeRepo) GetWorkspaceSubscription(_ context.Context, ws string) (string, bool, error) {
	if !f.wsExists[ws] {
		return "", false, nil
	}
	if st, ok := f.wsSub[ws]; ok {
		return st.ref, true, nil
	}
	return "", true, nil
}

func (f *fakeRepo) FindWorkspaceBySubscription(_ context.Context, ref string) (string, string, bool, error) {
	if f.findSubErr != nil {
		return "", "", false, f.findSubErr
	}
	ws, ok := f.bySub[ref]
	if !ok {
		return "", "", false, nil
	}
	return ws, f.wsPlan[ws], true, nil
}

func (f *fakeRepo) LatestPaidOrderInterval(_ context.Context, ws string) (string, bool, error) {
	iv, ok := f.paidIv[ws]
	return string(iv), ok, nil
}

func (f *fakeRepo) ExpireDueWorkspaces(_ context.Context, _ time.Time, _ int) ([]ExpiredWorkspace, error) {
	return f.expired, nil
}

func (f *fakeRepo) ExpireStaleOrders(_ context.Context, _ time.Time, _ int) ([]ExpiredOrder, error) {
	return f.staleOrders, nil
}

func (f *fakeRepo) InsertOverageOrder(_ context.Context, o domain.Order) (domain.Order, bool, error) {
	key := o.WorkspaceID + "|" + o.Metadata["overage_period"].(string)
	if f.overageIndex[key] {
		f.overageCalls = append(f.overageCalls, overageCall{order: o, created: false})
		return domain.Order{}, false, nil
	}
	f.overageIndex[key] = true
	o.ID = "ord_overage_" + key
	f.overageCalls = append(f.overageCalls, overageCall{order: o, created: true})
	f.orders[o.ID] = &o
	return o, true, nil
}

func (f *fakeRepo) ListMeteredWorkspaces(_ context.Context, _ int) ([]MeteredWorkspace, error) {
	return f.metered, nil
}

func (f *fakeRepo) RegisterMeter(_ context.Context, m Meter) error {
	if old, ok := f.meters[m.Slug]; ok {
		if old.AggType != m.AggType {
			return ErrMeterImmutable
		}
		old.DisplayName, old.Unit = m.DisplayName, m.Unit
		f.meters[m.Slug] = old
		return nil
	}
	f.meters[m.Slug] = m
	return nil
}

func (f *fakeRepo) ListMeters(_ context.Context) ([]Meter, error) {
	out := make([]Meter, 0, len(f.meters))
	for _, m := range f.meters {
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	return out, nil
}

func (f *fakeRepo) GetMeter(_ context.Context, slug string) (Meter, bool, error) {
	m, ok := f.meters[slug]
	return m, ok, nil
}

func TestServiceExpireDueWorkspaces_FansOutHooksAndAudit(t *testing.T) {
	repo := newFakeRepo()
	repo.expired = []ExpiredWorkspace{
		{WorkspaceID: "ws_1", FromPlan: "pro"},
		{WorkspaceID: "ws_2", FromPlan: "enterprise"},
	}
	auditor := &fakeAuditor{}
	hooks := &hookTrace{}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{
		OnPlanChanged: func(_ context.Context, ws, from, to string) error {
			hooks.planChanged = append(hooks.planChanged, [3]string{ws, from, to})
			return nil
		},
	}, auditor, func() time.Time { return testNow }, nil)

	got, err := svc.ExpireDueWorkspaces(context.Background(), testNow, 10)
	require.NoError(t, err)
	assert.Equal(t, repo.expired, got)

	assert.Equal(t, [][3]string{
		{"ws_1", "pro", "free"},
		{"ws_2", "enterprise", "free"},
	}, hooks.planChanged)
	assert.Len(t, auditor.calls, 2)
	for _, c := range auditor.calls {
		assert.Equal(t, "billing.plan_expired", c.action)
		assert.Equal(t, "workspace", c.resourceType)
	}
}

func TestServiceExpireStaleOrders_ReturnsIDsAndAudits(t *testing.T) {
	repo := newFakeRepo()
	repo.staleOrders = []ExpiredOrder{
		{ID: "ord_1", WorkspaceID: "ws_1"},
		{ID: "ord_2", WorkspaceID: "ws_2"},
	}
	auditor := &fakeAuditor{}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, auditor,
		func() time.Time { return testNow }, nil)

	ids, err := svc.ExpireStaleOrders(context.Background(), testNow, 10)
	require.NoError(t, err)
	assert.Equal(t, []string{"ord_1", "ord_2"}, ids)

	require.Len(t, auditor.calls, 2)
	for i, c := range auditor.calls {
		assert.Equal(t, "billing.order_expired", c.action)
		assert.Equal(t, "order", c.resourceType)
		assert.Equal(t, repo.staleOrders[i].ID, c.resourceID)
		assert.Equal(t, repo.staleOrders[i].WorkspaceID, *c.ws)
	}
}

type capsChannel struct {
	name string
	caps ChannelCaps
}

func (c *capsChannel) Name() string { return c.name }
func (c *capsChannel) CreateCheckout(_ context.Context, _ CheckoutRequest) (domain.CheckoutSession, error) {
	return domain.CheckoutSession{}, nil
}
func (c *capsChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, nil
}
func (c *capsChannel) Capabilities() ChannelCaps { return c.caps }

func TestChannelRegistry_OrderedNames(t *testing.T) {
	reg := NewChannelRegistry()
	reg.Register(&ManualChannel{}) // 内建 caps：DisplayOrder 900
	reg.Register(&capsChannel{name: "waffo", caps: ChannelCaps{DisplayOrder: 100, CatalogBased: true}})
	reg.Register(&capsChannel{name: "stripe", caps: ChannelCaps{DisplayOrder: 200, SupportsCancelURL: true}})
	reg.Register(&plainChannel{name: "beta"})  // 未声明 caps → 500
	reg.Register(&plainChannel{name: "alpha"}) // 未声明 caps → 500，同序按 name 升序

	assert.Equal(t,
		[]string{"waffo", "stripe", "alpha", "beta", "manual"},
		reg.OrderedNames(), "按 (DisplayOrder 升序, name 升序)；未声明能力者 500")
}

type reqCaptureChannel struct {
	name string
	req  *CheckoutRequest
	sess domain.CheckoutSession
}

func (c *reqCaptureChannel) Name() string { return c.name }
func (c *reqCaptureChannel) CreateCheckout(_ context.Context, req CheckoutRequest) (domain.CheckoutSession, error) {
	*c.req = req
	return c.sess, nil
}
func (c *reqCaptureChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, nil
}

func TestCreateCheckout_AssemblesRequest(t *testing.T) {
	seedPro := func() *fakeRepo {
		repo := newFakeRepo()
		repo.plans["pro"] = domain.Plan{Code: "pro", Limits: map[string]int{"price_monthly_cents": 9900}}
		return repo
	}
	newSvc := func(repo *fakeRepo, resolver BuyerEmailResolver) (*BillingService, *CheckoutRequest) {
		var got CheckoutRequest
		expiresAt := testNow.Add(24 * time.Hour)
		reg := NewChannelRegistry()
		reg.Register(&reqCaptureChannel{name: "cap", req: &got,
			sess: domain.CheckoutSession{OrderID: "ord_pro", Channel: "cap", SessionRef: "cs_1", ExpiresAt: expiresAt}})
		svc := NewBillingService(repo, reg, Config{
			SuccessURL: "https://app.example.com/s",
			CancelURL:  "https://app.example.com/c",
			Locale:     "zh",
		}, BillingHooks{}, nil, func() time.Time { return testNow }, nil).
			WithBuyerEmailResolver(resolver)
		return svc, &got
	}

	t.Run("resolver 与 Config 逐项透传 CheckoutRequest，会话引用+到期一并落库", func(t *testing.T) {
		repo := seedPro()
		svc, got := newSvc(repo, func(_ context.Context, _ string) (string, error) {
			return "buyer@test.dev", nil
		})

		_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalMonthly, "cap")
		require.NoError(t, err)

		assert.Equal(t, "pro", got.Order.PlanCode)
		assert.Equal(t, "usr_1", got.Order.UserID)
		assert.Equal(t, "https://app.example.com/s", got.SuccessURL)
		assert.Equal(t, "https://app.example.com/c", got.CancelURL)
		assert.Equal(t, "buyer@test.dev", got.BuyerEmail)
		assert.Equal(t, "zh", got.Locale)

		require.Len(t, repo.channelRefCalls, 1)
		assert.Equal(t, channelRefCall{id: "ord_pro", ref: "cs_1", expiresAt: testNow.Add(24 * time.Hour)}, repo.channelRefCalls[0])
	})

	t.Run("resolver 出错 → 邮箱留空不失败", func(t *testing.T) {
		repo := seedPro()
		svc, got := newSvc(repo, func(_ context.Context, _ string) (string, error) {
			return "", assert.AnError
		})

		_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalMonthly, "cap")
		require.NoError(t, err)
		assert.Empty(t, got.BuyerEmail)
	})

	t.Run("未注入 resolver → 邮箱留空", func(t *testing.T) {
		repo := seedPro()
		svc, got := newSvc(repo, nil)

		_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalMonthly, "cap")
		require.NoError(t, err)
		assert.Empty(t, got.BuyerEmail)
	})
}

type fakeChannel struct {
	event domain.PaymentEvent
}

func (f *fakeChannel) Name() string { return "stripe" }
func (f *fakeChannel) CreateCheckout(_ context.Context, _ CheckoutRequest) (domain.CheckoutSession, error) {
	return domain.CheckoutSession{}, nil
}
func (f *fakeChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return f.event, nil
}

type auditCall struct {
	ws           *string
	action       string
	resourceType string
	resourceID   string

	p    *webx.Principal
	meta map[string]any
}

type fakeAuditor struct{ calls []auditCall }

func (f *fakeAuditor) Record(_ context.Context, ws *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any) {
	f.calls = append(f.calls, auditCall{ws: ws, action: action, resourceType: resourceType, resourceID: resourceID, p: p, meta: meta})
}

type hookTrace struct {
	planChanged [][3]string
	renewed     [][2]any
}

var testNow = time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)

func TestHandleWebhook_SubscriptionPaid(t *testing.T) {
	tests := []struct {
		name       string
		planLimits map[string]int
		interval   domain.BillingInterval
		subRef     string
		wantSetSub bool
		wantExpiry time.Time
	}{
		{
			name:       "订阅支付 monthly → 到期 = now+1 自然月",
			planLimits: map[string]int{"price_monthly_cents": 9900},
			interval:   domain.IntervalMonthly,
			subRef:     "sub_1",
			wantSetSub: true,
			wantExpiry: testNow.AddDate(0, 1, 0),
		},
		{
			name:       "订阅支付 yearly → 到期 = now+1 年",
			planLimits: map[string]int{"price_yearly_cents": 99000},
			interval:   domain.IntervalYearly,
			subRef:     "sub_2",
			wantSetSub: true,
			wantExpiry: testNow.AddDate(1, 0, 0),
		},
		{
			name:       "订阅支付带 trial_days=14 → 试用期优先",
			planLimits: map[string]int{"price_monthly_cents": 9900, "trial_days": 14},
			interval:   domain.IntervalMonthly,
			subRef:     "sub_3",
			wantSetSub: true,
			wantExpiry: testNow.AddDate(0, 0, 14),
		},
		{
			name:       "一次性支付（无订阅号）→ 不写订阅状态",
			planLimits: map[string]int{"price_one_time_cents": 29900},
			interval:   domain.IntervalOneTime,
			subRef:     "",
			wantSetSub: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := newFakeRepo()
			repo.plans["pro"] = domain.Plan{Code: "pro", Limits: tt.planLimits}
			repo.orders["ord_1"] = &domain.Order{
				ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro",
				Interval: tt.interval, Status: domain.OrderPending, Currency: "usd",
			}
			auditor := &fakeAuditor{}
			hooks := &hookTrace{}
			reg := NewChannelRegistry()
			svc := NewBillingService(repo, reg, Config{}, BillingHooks{
				OnPlanChanged: func(_ context.Context, ws, from, to string) error {
					hooks.planChanged = append(hooks.planChanged, [3]string{ws, from, to})
					return nil
				},
			}, auditor, func() time.Time { return testNow }, nil)
			ch := &fakeChannel{event: domain.PaymentEvent{
				Channel: "stripe", ChannelEventID: "evt_1", Type: domain.EventCheckoutCompleted,
				OrderID: "ord_1", SubscriptionRef: tt.subRef,
			}}
			reg.Register(ch)

			require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))

			assert.Equal(t, domain.OrderPaid, repo.orders["ord_1"].Status)
			require.Len(t, repo.changePlans, 1)
			assert.Equal(t, [3]string{"ws_1", "free", "pro"}, hooks.planChanged[0])

			if tt.wantSetSub {
				require.Len(t, repo.setSubs, 1)
				assert.Equal(t, setSubCall{ws: "ws_1", ref: tt.subRef, expiresAt: tt.wantExpiry}, repo.setSubs[0])
			} else {
				assert.Empty(t, repo.setSubs)
			}
			assert.True(t, repo.processed["stripe:evt_1"], "事件应标记 processed")
		})
	}
}

func TestHandleWebhook_SubscriptionRenewed(t *testing.T) {
	tests := []struct {
		name       string
		paidIv     domain.BillingInterval
		hasPaidIv  bool
		wantExpiry time.Time
	}{
		{"周期=monthly → now+1 月", domain.IntervalMonthly, true, testNow.AddDate(0, 1, 0)},
		{"周期=yearly → now+1 年", domain.IntervalYearly, true, testNow.AddDate(1, 0, 0)},
		{"无 paid 订单 → 默认 monthly", domain.IntervalYearly, false, testNow.AddDate(0, 1, 0)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := newFakeRepo()
			repo.wsPlan["ws_9"] = "pro"
			repo.bySub["sub_r"] = "ws_9"
			repo.wsSub["ws_9"] = subState{ref: "sub_r", expiresAt: testNow.Add(-time.Hour)}
			if tt.hasPaidIv {
				repo.paidIv["ws_9"] = tt.paidIv
			}
			auditor := &fakeAuditor{}
			hooks := &hookTrace{}
			reg := NewChannelRegistry()
			svc := NewBillingService(repo, reg, Config{}, BillingHooks{
				OnSubscriptionRenewed: func(_ context.Context, ws string, expiresAt time.Time) error {
					hooks.renewed = append(hooks.renewed, [2]any{ws, expiresAt})
					return nil
				},
			}, auditor, func() time.Time { return testNow }, nil)
			ch := &fakeChannel{event: domain.PaymentEvent{
				Channel: "stripe", ChannelEventID: "evt_r", Type: domain.EventSubscriptionRenewed,
				SubscriptionRef: "sub_r",
			}}
			reg.Register(ch)

			require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))

			require.Len(t, repo.setSubs, 1)
			assert.Equal(t, setSubCall{ws: "ws_9", ref: "sub_r", expiresAt: tt.wantExpiry}, repo.setSubs[0])
			assert.True(t, repo.wsSub["ws_9"].expiresAt.Equal(tt.wantExpiry))

			require.Len(t, hooks.renewed, 1)
			assert.Equal(t, "ws_9", hooks.renewed[0][0])
			assert.True(t, hooks.renewed[0][1].(time.Time).Equal(tt.wantExpiry))
			require.Len(t, auditor.calls, 1)
			assert.Equal(t, "billing.subscription_renewed", auditor.calls[0].action)
			assert.True(t, repo.processed["stripe:evt_r"])

			assert.Empty(t, repo.changePlans)
		})
	}
}

func TestHandleWebhook_SubscriptionRenewedUnknown(t *testing.T) {
	repo := newFakeRepo()
	reg := NewChannelRegistry()
	svc := NewBillingService(repo, reg, Config{}, BillingHooks{}, &fakeAuditor{},
		func() time.Time { return testNow }, nil)
	ch := &fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_x", Type: domain.EventSubscriptionRenewed,
		SubscriptionRef: "sub_ghost",
	}}
	reg.Register(ch)

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.Empty(t, repo.setSubs, "未知订阅号不得写任何状态")
	assert.True(t, repo.processed["stripe:evt_x"], "未知订阅号也应标记 processed（不再重试）")
}

func TestHandleWebhook_SubscriptionCanceled(t *testing.T) {
	repo := newFakeRepo()
	repo.wsPlan["ws_1"] = "pro"
	repo.bySub["sub_1"] = "ws_1"
	repo.wsSub["ws_1"] = subState{ref: "sub_1", expiresAt: testNow.AddDate(0, 1, 0)}
	auditor := &fakeAuditor{}
	hooks := &hookTrace{}
	reg := NewChannelRegistry()
	svc := NewBillingService(repo, reg, Config{}, BillingHooks{
		OnPlanChanged: func(_ context.Context, ws, from, to string) error {
			hooks.planChanged = append(hooks.planChanged, [3]string{ws, from, to})
			return nil
		},
	}, auditor, func() time.Time { return testNow }, nil)
	ch := &fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_c", Type: domain.EventSubscriptionCanceled,
		SubscriptionRef: "sub_1",
	}}
	reg.Register(ch)

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))

	require.Len(t, repo.changePlans, 1)
	assert.Equal(t, "ws_1", repo.changePlans[0].ws)
	assert.Equal(t, "free", repo.changePlans[0].to)
	assert.Equal(t, "webhook:stripe", repo.changePlans[0].actor)
	assert.Equal(t, "subscription:sub_1", repo.changePlans[0].reason)
	assert.Equal(t, "free", repo.wsPlan["ws_1"])

	require.Len(t, repo.setSubs, 1)
	assert.Equal(t, setSubCall{ws: "ws_1", ref: ""}, repo.setSubs[0])
	_, still := repo.bySub["sub_1"]
	assert.False(t, still, "订阅号反查应失效")

	require.Len(t, hooks.planChanged, 1)
	assert.Equal(t, [3]string{"ws_1", "pro", "free"}, hooks.planChanged[0])
	require.Len(t, auditor.calls, 1)
	assert.Equal(t, "billing.subscription_canceled", auditor.calls[0].action)
	assert.True(t, repo.processed["stripe:evt_c"])
}

func TestHandleWebhook_SubscriptionCanceledUnknown(t *testing.T) {
	repo := newFakeRepo()
	reg := NewChannelRegistry()
	svc := NewBillingService(repo, reg, Config{}, BillingHooks{}, &fakeAuditor{},
		func() time.Time { return testNow }, nil)
	ch := &fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_y", Type: domain.EventSubscriptionCanceled,
		SubscriptionRef: "sub_ghost",
	}}
	reg.Register(ch)

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.Empty(t, repo.changePlans)
	assert.Empty(t, repo.setSubs)
	assert.True(t, repo.processed["stripe:evt_y"])
}

func principal() *webx.Principal { return &webx.Principal{UserID: "usr_1"} }

// catalogStaticChannel 是目录型渠道测试替身:CatalogBased=true,可选携带
// 静态商品(StaticProductResolver)与映射表行,验证 BC-7 回退次序
// DB 映射 > 适配器静态 > 自动注册 > 400(shuijing 生产实修 2026-10-26)。
type catalogStaticChannel struct {
	name    string
	req     *CheckoutRequest
	static  map[domain.BillingInterval]string
	sessRef string
}

func (c *catalogStaticChannel) Name() string { return c.name }
func (c *catalogStaticChannel) CreateCheckout(_ context.Context, req CheckoutRequest) (domain.CheckoutSession, error) {
	*c.req = req
	return domain.CheckoutSession{OrderID: req.Order.ID, Channel: c.name, SessionRef: c.sessRef, ExpiresAt: testNow.Add(time.Hour)}, nil
}
func (c *catalogStaticChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, nil
}
func (c *catalogStaticChannel) Capabilities() ChannelCaps { return ChannelCaps{CatalogBased: true} }
func (c *catalogStaticChannel) StaticProductID(_ string, interval domain.BillingInterval) string {
	return c.static[interval]
}

func newCatalogStaticSvc(repo *fakeRepo, ch *catalogStaticChannel) *BillingService {
	reg := NewChannelRegistry()
	reg.Register(ch)
	return NewBillingService(repo, reg, Config{
		SuccessURL: "https://app.example.com/s", CancelURL: "https://app.example.com/c",
	}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)
}

func TestCreateCheckout_CatalogStaticFallback(t *testing.T) {
	seed := func() (*fakeRepo, *catalogStaticChannel, *CheckoutRequest) {
		repo := newFakeRepo()
		repo.plans["pro"] = domain.Plan{Code: "pro", Limits: map[string]int{"price_monthly_cents": 9900}}
		var got CheckoutRequest
		ch := &catalogStaticChannel{name: "cat", req: &got, sessRef: "cs_cat",
			static: map[domain.BillingInterval]string{domain.IntervalMonthly: "PROD_static_m"}}
		return repo, ch, &got
	}

	t.Run("映射表缺行+静态商品在配 → 静态回退生效,不再 400", func(t *testing.T) {
		repo, ch, got := seed()
		svc := newCatalogStaticSvc(repo, ch)
		_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalMonthly, "cat")
		require.NoError(t, err, "AutoRegisterCatalog=false 且映射表空,静态商品应兜住(shuijing 生产事故路径)")
		assert.Equal(t, "PROD_static_m", got.ChannelProductID)
	})

	t.Run("映射表有行 → DB 行优先于静态商品", func(t *testing.T) {
		repo, ch, got := seed()
		if repo.chanProducts == nil {
			repo.chanProducts = map[string]domain.ChannelProduct{}
		}
		repo.chanProducts["cat/pro/"+string(domain.IntervalMonthly)] = domain.ChannelProduct{
			Channel: "cat", PlanCode: "pro", Interval: domain.IntervalMonthly, ChannelProductID: "PROD_db_row",
		}
		svc := newCatalogStaticSvc(repo, ch)
		_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalMonthly, "cat")
		require.NoError(t, err)
		assert.Equal(t, "PROD_db_row", got.ChannelProductID)
	})

	t.Run("静态空+自动注册关 → 仍 400 报清晰错误", func(t *testing.T) {
		repo, ch, _ := seed()
		ch.static = nil
		svc := newCatalogStaticSvc(repo, ch)
		_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalMonthly, "cat")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "尚未注册")
	})
}

func TestCreateCheckout_PassesTrialDays(t *testing.T) {

	repo := newFakeRepo()
	repo.plans["pro"] = domain.Plan{Code: "pro", Limits: map[string]int{"price_monthly_cents": 9900, "trial_days": 7}}
	var gotOrder domain.Order
	ch := &trialChannel{capture: &gotOrder}
	reg := NewChannelRegistry()
	reg.Register(ch)
	svc := NewBillingService(repo, reg, Config{Currency: "USD"}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil)

	_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalMonthly, "trialchan")
	require.NoError(t, err)
	assert.Equal(t, 7, gotOrder.TrialDays)
}

type trialChannel struct{ capture *domain.Order }

func (c *trialChannel) Name() string { return "trialchan" }
func (c *trialChannel) CreateCheckout(_ context.Context, req CheckoutRequest) (domain.CheckoutSession, error) {
	*c.capture = req.Order
	return domain.CheckoutSession{OrderID: req.Order.ID, Channel: c.Name()}, nil
}
func (c *trialChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, nil
}

func chanProductKey(channel, planCode string, interval domain.BillingInterval) string {
	return channel + "/" + planCode + "/" + string(interval)
}

func (f *fakeRepo) GetChannelProduct(_ context.Context, channel, planCode string, interval domain.BillingInterval) (domain.ChannelProduct, bool, error) {
	if f.chanProductErr != nil {
		return domain.ChannelProduct{}, false, f.chanProductErr
	}
	if f.chanProducts == nil {
		return domain.ChannelProduct{}, false, nil
	}
	p, ok := f.chanProducts[chanProductKey(channel, planCode, interval)]
	return p, ok, nil
}

func (f *fakeRepo) UpsertChannelProduct(_ context.Context, p domain.ChannelProduct) error {
	if f.chanProductErr != nil {
		return f.chanProductErr
	}
	if f.chanProducts == nil {
		f.chanProducts = map[string]domain.ChannelProduct{}
	}
	f.chanProducts[chanProductKey(p.Channel, p.PlanCode, p.Interval)] = p
	f.chanUpserts = append(f.chanUpserts, p)
	return nil
}

func (f *fakeRepo) ListChannelProducts(context.Context) ([]domain.ChannelProduct, error) {
	if f.chanProductErr != nil {
		return nil, f.chanProductErr
	}
	out := make([]domain.ChannelProduct, 0, len(f.chanProducts))
	for _, p := range f.chanProducts {
		out = append(out, p)
	}
	return out, nil
}

// RegisterChannelProductAtomic mirrors the pgrepo advisory-lock semantics
// single-threaded: existing mapping → (existing, true); otherwise run the
// register callback and upsert (fix #12 的 hermetic 形态——并发串行化只在
// 真 DB 测试里验证).
func (f *fakeRepo) RegisterChannelProductAtomic(ctx context.Context, channel, planCode string, interval domain.BillingInterval,
	register func(context.Context) (string, error), syncedPriceCents int, syncedAt time.Time) (string, bool, error) {
	if f.chanProductErr != nil {
		return "", false, f.chanProductErr
	}
	if p, ok := f.chanProducts[chanProductKey(channel, planCode, interval)]; ok {
		return p.ChannelProductID, true, nil
	}
	id, err := register(ctx)
	if err != nil {
		return "", false, err
	}
	p := domain.ChannelProduct{
		Channel: channel, PlanCode: planCode, Interval: interval,
		ChannelProductID: id, SyncedPriceCents: syncedPriceCents, SyncedAt: &syncedAt,
	}
	if f.chanProducts == nil {
		f.chanProducts = map[string]domain.ChannelProduct{}
	}
	f.chanProducts[chanProductKey(channel, planCode, interval)] = p
	f.chanUpserts = append(f.chanUpserts, p)
	return id, false, nil
}

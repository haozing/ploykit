package app

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

// atomicTestChannel is a minimal channel with optional capability/schema faces.
type atomicTestChannel struct {
	name  string
	order int
	caps  *ChannelCaps
}

func (c *atomicTestChannel) Name() string { return c.name }
func (c *atomicTestChannel) CreateCheckout(_ context.Context, _ CheckoutRequest) (domain.CheckoutSession, error) {
	return domain.CheckoutSession{}, nil
}
func (c *atomicTestChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, nil
}
func (c *atomicTestChannel) Capabilities() ChannelCaps {
	if c.caps != nil {
		return *c.caps
	}
	return ChannelCaps{DisplayOrder: c.order}
}

func TestAtomicRegistry_RebuildAndSwap(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var fields atomic.Value // map[string]map[string]string
	fields.Store(map[string]map[string]string{})
	source := func(context.Context) (map[string]map[string]string, error) {
		return fields.Load().(map[string]map[string]string), nil
	}
	factoryCalls := atomic.Int64{}
	factories := map[string]func(map[string]string) (PaymentChannel, error){
		"waffo": func(f map[string]string) (PaymentChannel, error) {
			factoryCalls.Add(1)
			if f == nil || f["merchant_id"] == "" {
				return nil, nil // 未配置
			}
			return &atomicTestChannel{name: "waffo", order: 100}, nil
		},
		"manual": func(map[string]string) (PaymentChannel, error) {
			return &atomicTestChannel{name: "manual", order: 900}, nil
		},
	}

	reg := NewAtomicRegistry(ctx, nil, source, factories, time.Hour) // 慢轮询：只考察显式 RefreshNow
	assert.Equal(t, []string{"manual"}, reg.OrderedNames(), "启动即构建一次：未配置渠道不注册")

	// 写入 waffo 凭据 → RefreshNow 原子换指针。
	fields.Store(map[string]map[string]string{"waffo": {"merchant_id": "MER_1"}})
	require.NoError(t, reg.RefreshNow(ctx))
	assert.Equal(t, []string{"waffo", "manual"}, reg.OrderedNames(), "能力排序：waffo(100) < manual(900)")
	_, ok := reg.Get("waffo")
	assert.True(t, ok)

	// 清空凭据 → 渠道摘除。
	fields.Store(map[string]map[string]string{})
	require.NoError(t, reg.RefreshNow(ctx))
	_, ok = reg.Get("waffo")
	assert.False(t, ok)

	// 工厂报错 → 该渠道跳过、其余保留。
	factories["manual"] = func(map[string]string) (PaymentChannel, error) { return nil, assert.AnError }
	require.NoError(t, reg.RefreshNow(ctx))
	assert.Empty(t, reg.OrderedNames())

	// 工厂名不匹配 → 跳过。
	factories["manual"] = func(map[string]string) (PaymentChannel, error) {
		return &atomicTestChannel{name: "not-manual"}, nil
	}
	require.NoError(t, reg.RefreshNow(ctx))
	assert.Empty(t, reg.OrderedNames(), "工厂名与渠道 Name() 不一致不得注册")
}

func TestAtomicRegistry_SourceErrorKeepsOldSet(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var fail atomic.Bool
	fields := map[string]map[string]string{"manual": {"info_url": "https://x"}}
	reg := NewAtomicRegistry(ctx, nil, func(context.Context) (map[string]map[string]string, error) {
		if fail.Load() {
			return nil, errors.New("db down")
		}
		return fields, nil
	}, map[string]func(map[string]string) (PaymentChannel, error){
		"manual": func(map[string]string) (PaymentChannel, error) {
			return &atomicTestChannel{name: "manual"}, nil
		},
	}, time.Hour)

	require.Len(t, reg.OrderedNames(), 1)

	fail.Store(true)
	err := reg.RefreshNow(ctx)
	require.Error(t, err)
	_, ok := reg.Get("manual")
	assert.True(t, ok, "source 出错必须保留旧集合")
	require.Len(t, reg.OrderedNames(), 1)
}

func TestAtomicRegistry_InitialSourceErrorStartsEmpty(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	reg := NewAtomicRegistry(ctx, nil, func(context.Context) (map[string]map[string]string, error) {
		return nil, errors.New("db down at boot")
	}, map[string]func(map[string]string) (PaymentChannel, error){
		"manual": func(map[string]string) (PaymentChannel, error) {
			return &atomicTestChannel{name: "manual"}, nil
		},
	}, time.Hour)
	assert.Empty(t, reg.OrderedNames(), "启动构建失败 = 空集合（不 panic），下一轮询自愈")
}

// ---- CreateCheckout 目录解析（BC-7） ----

type catalogChannel struct {
	name            string
	gotProductID    string
	registerCalls   int
	syncCalls       []string
	registerErr     error
	unpricedPlan    bool
	supportsRegjoin bool
}

func (c *catalogChannel) Name() string { return c.name }
func (c *catalogChannel) CreateCheckout(_ context.Context, req CheckoutRequest) (domain.CheckoutSession, error) {
	c.gotProductID = req.ChannelProductID
	return domain.CheckoutSession{OrderID: req.Order.ID, SessionRef: "cs_1"}, nil
}
func (c *catalogChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, nil
}
func (c *catalogChannel) Capabilities() ChannelCaps {
	return ChannelCaps{CatalogBased: true, DisplayOrder: 100}
}
func (c *catalogChannel) RegisterProduct(_ context.Context, plan domain.Plan, interval domain.BillingInterval) (string, error) {
	c.registerCalls++
	if c.registerErr != nil {
		return "", c.registerErr
	}
	return "PROD_NEW_" + plan.Code + "_" + string(interval), nil
}
func (c *catalogChannel) SyncPrice(_ context.Context, id string, _ domain.Plan, _ domain.BillingInterval) error {
	c.syncCalls = append(c.syncCalls, id)
	return nil
}

func seedCatalogPlan(repo *fakeRepo) {
	repo.plans["pro"] = domain.Plan{Code: "pro", Name: "Pro", Currency: "USD",
		Limits: map[string]int{"price_monthly_cents": 990, "price_yearly_cents": 9900}}
	repo.wsExists["ws_1"] = true
}

func newCatalogSvc(repo *fakeRepo, autoRegister bool, channels ...PaymentChannel) *BillingService {
	reg := NewChannelRegistry()
	for _, ch := range channels {
		reg.Register(ch)
	}
	return NewBillingService(repo, reg, Config{AutoRegisterCatalog: autoRegister}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil)
}

func TestCreateCheckout_CatalogMappingFilled(t *testing.T) {
	repo := newFakeRepo()
	seedCatalogPlan(repo)
	syncedAt := testNow
	repo.chanProducts = map[string]domain.ChannelProduct{
		"catalog/pro/monthly": {Channel: "catalog", PlanCode: "pro", Interval: domain.IntervalMonthly, ChannelProductID: "PROD_990", SyncedPriceCents: 990, SyncedAt: &syncedAt},
	}
	ch := &catalogChannel{name: "catalog"}
	svc := newCatalogSvc(repo, false, ch)

	sess, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalMonthly, "catalog")
	require.NoError(t, err)
	assert.Equal(t, "cs_1", sess.SessionRef)
	assert.Equal(t, "PROD_990", ch.gotProductID, "映射命中 → CheckoutRequest.ChannelProductID 填充")
	assert.Zero(t, ch.registerCalls)
}

func TestCreateCheckout_CatalogMissWithoutAutoRegister(t *testing.T) {
	repo := newFakeRepo()
	seedCatalogPlan(repo)
	ch := &catalogChannel{name: "catalog"}
	svc := newCatalogSvc(repo, false, ch)

	_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalMonthly, "catalog")
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 400, we.Status)
	assert.Contains(t, we.Message, "catalog", "文案含渠道名")
	assert.Contains(t, we.Message, "后台", "文案含后台注册指引")
	assert.Empty(t, repo.orders, "未映射时不得先建 pending 订单")
	assert.Zero(t, ch.registerCalls)
}

func TestCreateCheckout_CatalogAutoRegister(t *testing.T) {
	repo := newFakeRepo()
	seedCatalogPlan(repo)
	ch := &catalogChannel{name: "catalog"}
	svc := newCatalogSvc(repo, true, ch)

	_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalYearly, "catalog")
	require.NoError(t, err)
	assert.Equal(t, 1, ch.registerCalls, "AutoRegisterCatalog 开 → 未命中时自动注册")
	assert.Equal(t, "PROD_NEW_pro_yearly", ch.gotProductID)

	updated, ok := repo.chanProducts["catalog/pro/yearly"]
	require.True(t, ok, "自动注册后映射落库")
	assert.Equal(t, "PROD_NEW_pro_yearly", updated.ChannelProductID)
	assert.Equal(t, 9900, updated.SyncedPriceCents)
	require.NotNil(t, updated.SyncedAt)
}

func TestCreateCheckout_NonCatalogChannelSkipsResolution(t *testing.T) {
	repo := newFakeRepo()
	seedCatalogPlan(repo)
	repo.chanProductErr = assert.AnError // 即便 repo 侧出错也不该被触碰
	ch := &plainChannel{name: "ad hoc"}
	svc := newCatalogSvc(repo, true, ch)

	_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalMonthly, "ad hoc")
	require.NoError(t, err, "非目录型渠道（未声明 CatalogBased）不查映射")
}

// ---- BillingAdminService 渠道卡/目录/注册/改价（BC-6/BC-7 服务层） ----

type fakeChannelSettings struct {
	saved map[string]string
	getErr error
}

func newFakeChannelSettings() *fakeChannelSettings {
	return &fakeChannelSettings{saved: map[string]string{}}
}

func (f *fakeChannelSettings) Set(_ context.Context, key, value, _ string) error {
	f.saved[key] = value
	return nil
}

func (f *fakeChannelSettings) BillingChannelFields(context.Context) (map[string]map[string]string, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	out := map[string]map[string]string{}
	for k, v := range f.saved {
		rest := k[len("billing_channel."):]
		name, field, _ := cutString(rest, ".")
		if out[name] == nil {
			out[name] = map[string]string{}
		}
		out[name][field] = v
	}
	return out, nil
}

func cutString(s, sep string) (before, after string, found bool) {
	for i := 0; i+len(sep) <= len(s); i++ {
		if s[i:i+len(sep)] == sep {
			return s[:i], s[i+len(sep):], true
		}
	}
	return s, "", false
}

// schemaChannel: a catalog channel that additionally self-describes its
// config schema (ChannelSchemaViewer + ChannelConfigViewer).
type schemaChannel struct {
	catalogChannel
}

func (c *schemaChannel) CreateCheckout(ctx context.Context, req CheckoutRequest) (domain.CheckoutSession, error) {
	return c.catalogChannel.CreateCheckout(ctx, req)
}

func (c *schemaChannel) ConfigSchema() []FieldSpec {
	return []FieldSpec{
		{Key: "merchant_id", Label: "Merchant ID", Type: FieldTypeText, Required: true},
		{Key: "private_key", Label: "私钥", Type: FieldTypeSecret, Required: true},
		{Key: "mode", Label: "模式", Type: FieldTypeSelect, Options: []FieldOption{{Value: "test"}, {Value: "prod"}}},
	}
}

func (c *schemaChannel) ChannelConfig() ChannelConfigInfo {
	return ChannelConfigInfo{Configured: true, KeyMasked: "MER_***x12", WebhookConfigured: true}
}

func newChannelAdminSvc(t *testing.T, settingsStore *fakeChannelSettings, channels ...PaymentChannel) *BillingAdminService {
	t.Helper()
	reg := NewChannelRegistry()
	for _, ch := range channels {
		reg.Register(ch)
	}
	core := NewBillingService(newFakeRepo(), reg, Config{}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)
	svc := NewBillingAdminService(core, nil, func() time.Time { return testNow }, nil)
	if settingsStore != nil {
		svc = svc.WithChannelSettings(settingsStore)
	}
	return svc
}

func TestChannelCards_Assembly(t *testing.T) {
	settings := newFakeChannelSettings()
	settings.saved["billing_channel.cat.merchant_id"] = "MER_1"
	settings.saved["billing_channel.cat.private_key"] = "k"
	settings.saved["billing_channel.cat.mode"] = ""
	ch := &schemaChannel{}
	ch.catalogChannel = catalogChannel{name: "cat"}
	svc := newChannelAdminSvc(t, settings, ch)

	cards, err := svc.ChannelCards(context.Background())
	require.NoError(t, err)
	require.Len(t, cards, 1)

	card := cards[0]
	assert.Equal(t, "cat", card.Name)
	assert.True(t, card.Configured)
	assert.Equal(t, "MER_***x12", card.KeyMasked)
	assert.True(t, card.WebhookConfigured)
	assert.True(t, card.Capabilities.CatalogBased)
	assert.Equal(t, 100, card.Capabilities.DisplayOrder)
	require.Len(t, card.Schema, 3)
	assert.Equal(t, "db", card.ConfigSource)
	assert.Equal(t, map[string]string{"merchant_id": "MER_1", "private_key": "__SET__", "mode": ""}, card.Values)
}

func TestChannelCards_NoDBRowsConfigSourceEnv(t *testing.T) {
	ch := &schemaChannel{}
	ch.catalogChannel = catalogChannel{name: "cat"}
	svc := newChannelAdminSvc(t, newFakeChannelSettings(), ch)

	cards, err := svc.ChannelCards(context.Background())
	require.NoError(t, err)
	require.Len(t, cards, 1)
	assert.Equal(t, "env", cards[0].ConfigSource)
	assert.Equal(t, map[string]string{"merchant_id": "", "private_key": "", "mode": ""}, cards[0].Values)
}

func TestUpdateChannelFields_Semantics(t *testing.T) {
	t.Run("secret 空串=保持；text=覆写；未知字段=400；select 非法=400", func(t *testing.T) {
		settings := newFakeChannelSettings()
		settings.saved["billing_channel.cat.private_key"] = "old-key"
		ch := &schemaChannel{}
		ch.catalogChannel = catalogChannel{name: "cat"}
		svc := newChannelAdminSvc(t, settings, ch)

		card, err := svc.UpdateChannelFields(context.Background(), principal(), "cat", map[string]string{
			"merchant_id": "MER_2",
			"private_key": "", // keep
		})
		require.NoError(t, err)
		assert.Equal(t, "MER_2", settings.saved["billing_channel.cat.merchant_id"])
		assert.Equal(t, "old-key", settings.saved["billing_channel.cat.private_key"], "secret 空串保持不变")
		assert.Equal(t, "__SET__", card.Values["private_key"])
		assert.Equal(t, "MER_2", card.Values["merchant_id"])
		assert.Equal(t, "db", card.ConfigSource, "保存后卡片 config_source 即时为 db")

		_, err = svc.UpdateChannelFields(context.Background(), principal(), "cat", map[string]string{"rogue": "x"})
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, 400, we.Status)

		_, err = svc.UpdateChannelFields(context.Background(), principal(), "cat", map[string]string{"mode": "staging"})
		require.ErrorAs(t, err, &we)
		assert.Equal(t, 400, we.Status, "select 字段值必须在 Options 内")
	})

	t.Run("未知渠道 404；无 schema 渠道 400", func(t *testing.T) {
		svc := newChannelAdminSvc(t, newFakeChannelSettings(), &plainChannel{name: "plain"})
		_, err := svc.UpdateChannelFields(context.Background(), principal(), "ghost", map[string]string{})
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, 404, we.Status)

		_, err = svc.UpdateChannelFields(context.Background(), principal(), "plain", map[string]string{"a": "b"})
		require.ErrorAs(t, err, &we)
		assert.Equal(t, 400, we.Status, "未实现 ChannelSchemaViewer 的渠道不可后台编辑")
	})
}

func TestRegisterAndSyncChannelProduct(t *testing.T) {
	repo := newFakeRepo()
	seedCatalogPlan(repo)
	reg := NewChannelRegistry()
	ch := &catalogChannel{name: "catalog"}
	reg.Register(ch)
	core := NewBillingService(repo, reg, Config{}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)
	svc := NewBillingAdminService(core, nil, func() time.Time { return testNow }, nil)

	id, err := svc.RegisterChannelProduct(context.Background(), principal(), "catalog", "pro", "monthly")
	require.NoError(t, err)
	assert.Equal(t, "PROD_NEW_pro_monthly", id)
	require.Len(t, repo.chanUpserts, 1)
	assert.Equal(t, 990, repo.chanUpserts[0].SyncedPriceCents)

	// 幂等：已有映射直接返回现有 id，不再调渠道。
	id2, err := svc.RegisterChannelProduct(context.Background(), principal(), "catalog", "pro", "monthly")
	require.NoError(t, err)
	assert.Equal(t, "PROD_NEW_pro_monthly", id2)
	assert.Equal(t, 1, ch.registerCalls)

	// 改价：改 plan 价后 SyncPrice 对齐。
	repo.plans["pro"] = domain.Plan{Code: "pro", Currency: "USD", Limits: map[string]int{"price_monthly_cents": 1990}}
	cents, err := svc.SyncChannelPrice(context.Background(), principal(), "catalog", "pro", "monthly")
	require.NoError(t, err)
	assert.Equal(t, 1990, cents)
	assert.Equal(t, []string{"PROD_NEW_pro_monthly"}, ch.syncCalls)
	assert.Equal(t, 1990, repo.chanProducts["catalog/pro/monthly"].SyncedPriceCents)
	require.NotNil(t, repo.chanProducts["catalog/pro/monthly"].SyncedAt)

	// 未注册映射 → 404；非 ProductRegistrar 渠道 → 400。
	_, err = svc.SyncChannelPrice(context.Background(), principal(), "catalog", "pro", "yearly")
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 404, we.Status)

	reg2 := NewChannelRegistry()
	reg2.Register(&plainChannel{name: "plain"})
	core2 := NewBillingService(repo, reg2, Config{}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)
	svc2 := NewBillingAdminService(core2, nil, func() time.Time { return testNow }, nil)
	_, err = svc2.RegisterChannelProduct(context.Background(), principal(), "plain", "pro", "monthly")
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 400, we.Status)
	assert.Equal(t, CodeChannelProductUnsupported, we.Code)
}

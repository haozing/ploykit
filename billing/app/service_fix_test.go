package app

// billing 内核缺陷修复的 hermetic 测试（2026-10-24 修复批次）。DB 侧语义
// （迁移 051 / 宽限期 / advisory lock / SetMany）在 pgrepo 与 settings 包的
// DB 测试里覆盖；这里验证服务层语义。

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/sealx"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- fix #1：弃单清扫 vs 迟到支付事件（复活路径） ----

func seedCanceledOrder(repo *fakeRepo, id, canceledBy string) {
	repo.orders[id] = &domain.Order{
		ID: id, WorkspaceID: "ws_1", PlanCode: "pro", Interval: domain.IntervalMonthly,
		AmountCents: 9900, Currency: "CNY", Channel: "stripe", Status: domain.OrderCanceled,
	}
	if canceledBy != "" {
		if repo.canceledBy == nil {
			repo.canceledBy = map[string]string{}
		}
		repo.canceledBy[id] = canceledBy
	}
}

func TestHandlePaid_RevivesExpiryCanceledOrder_Fix1(t *testing.T) {
	t.Run("canceled_by=expiry → canceled→paid 复活 + 权益照发 + 审计留痕", func(t *testing.T) {
		repo := newFakeRepo()
		seedCanceledOrder(repo, "ord_1", "expiry")
		svc, reg := webhookSvc(repo, BillingHooks{})
		auditor := svc.auditor.(*fakeAuditor)

		require.NoError(t, fireWebhook(t, svc, reg, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_late", Type: domain.EventCheckoutCompleted,
			OrderID: "ord_1", ChannelRef: "cs_1", AmountCents: 9900, Currency: "CNY",
		}))

		assert.Equal(t, domain.OrderPaid, repo.orders["ord_1"].Status, "迟到支付赢过清扫的启发式记账")
		assert.NotNil(t, repo.orders["ord_1"].PaidAt)
		assert.Equal(t, "pro", repo.wsPlan["ws_1"], "复活后发权益逻辑照常")
		assert.True(t, repo.processed["stripe:evt_late"])

		found := false
		for _, c := range auditor.calls {
			if c.action == "billing.order_revived_after_expiry" {
				found = true
			}
		}
		assert.True(t, found, "复活必须审计留痕")
	})

	t.Run("canceled_by=user → 维持现状忽略（钱退回渠道侧处理）", func(t *testing.T) {
		repo := newFakeRepo()
		seedCanceledOrder(repo, "ord_1", "user")
		svc, reg := webhookSvc(repo, BillingHooks{})

		require.NoError(t, fireWebhook(t, svc, reg, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_u", Type: domain.EventCheckoutCompleted,
			OrderID: "ord_1", AmountCents: 9900, Currency: "CNY",
		}))
		assert.Equal(t, domain.OrderCanceled, repo.orders["ord_1"].Status, "用户取消不可复活")
		_, written := repo.wsPlan["ws_1"]
		assert.False(t, written, "不发权益")
		assert.True(t, repo.processed["stripe:evt_u"])
	})

	t.Run("canceled_by=NULL（051 前存量行）→ 忽略", func(t *testing.T) {
		repo := newFakeRepo()
		seedCanceledOrder(repo, "ord_1", "")
		svc, reg := webhookSvc(repo, BillingHooks{})

		require.NoError(t, fireWebhook(t, svc, reg, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_n", Type: domain.EventCheckoutCompleted,
			OrderID: "ord_1", AmountCents: 9900, Currency: "CNY",
		}))
		assert.Equal(t, domain.OrderCanceled, repo.orders["ord_1"].Status, "来源不明不复活")
	})

	t.Run("paid 终局撞 paid 事件 → 仍是原幂等语义（不进复活分支）", func(t *testing.T) {
		repo := newFakeRepo()
		seedPaidOrder(repo, "ord_p", "")
		repo.orders["ord_p"].Status = domain.OrderPaid
		svc, reg := webhookSvc(repo, BillingHooks{})
		require.NoError(t, fireWebhook(t, svc, reg, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_dup", Type: domain.EventCheckoutCompleted,
			OrderID: "ord_p", AmountCents: 9900, Currency: "CNY",
		}))
		assert.Equal(t, domain.OrderPaid, repo.orders["ord_p"].Status)
	})
}

// ---- fix #3：续期接缝（PI 锚 + 金额对账） ----

func TestHandleRenewed_PaymentIntentAnchor_Fix3(t *testing.T) {
	repo := newFakeRepo()
	repo.bySub["sub_1"] = "ws_1"
	repo.wsPlan["ws_1"] = "pro"
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro",
		Interval: domain.IntervalMonthly, Status: domain.OrderPaid}
	repo.plans["pro"] = domain.Plan{Code: "pro", Limits: map[string]int{"price_monthly_cents": 9900}}
	svc, reg := webhookSvc(repo, BillingHooks{})

	require.NoError(t, fireWebhook(t, svc, reg, domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_pi", Type: domain.EventSubscriptionRenewed,
		SubscriptionRef: "sub_1", OrderID: "ord_1", PaymentIntentRef: "pi_9", AmountCents: 9900, Currency: "CNY",
	}))
	assert.Equal(t, "ord_1", repo.byPI["pi_9"],
		"fix #3：续期事件携带 PI 必须锚进订单 metadata（此前全仓只在 handlePaid 落，退款反查锚死代码）")
	assert.True(t, repo.processed["stripe:evt_pi"])
}

func TestHandleRenewed_AmountMismatch_RefusesRenewal_Fix3(t *testing.T) {
	seedRenewal := func(priceCents int) (*fakeRepo, *BillingService, *ChannelRegistry) {
		repo := newFakeRepo()
		repo.bySub["sub_1"] = "ws_1"
		repo.wsPlan["ws_1"] = "pro"
		repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro",
			Interval: domain.IntervalMonthly, Status: domain.OrderPaid,
			AmountCents: 9900, Currency: "CNY"}
		if priceCents > 0 {
			repo.plans["pro"] = domain.Plan{Code: "pro", Limits: map[string]int{"price_monthly_cents": priceCents}}
		}
		svc, reg := webhookSvc(repo, BillingHooks{})
		return repo, svc, reg
	}

	t.Run("目录价≠收款价 → 拒发续期 + 告警收敛（processed）+ 审计", func(t *testing.T) {
		repo, svc, reg := seedRenewal(1990) // 当前目录价已调到 1990，渠道仍收 990
		auditor := svc.auditor.(*fakeAuditor)
		require.NoError(t, fireWebhook(t, svc, reg, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_m", Type: domain.EventSubscriptionRenewed,
			SubscriptionRef: "sub_1", OrderID: "ord_1", AmountCents: 990, Currency: "CNY",
		}))
		assert.Empty(t, repo.setSubs, "不发放续期（到期时间不重订）")
		assert.Empty(t, repo.changePlans, "不换档")
		assert.True(t, repo.processed["stripe:evt_m"], "重试不会修复金额错配：告警收敛")
		found := false
		for _, c := range auditor.calls {
			if c.action == "billing.amount_mismatch" {
				found = true
			}
		}
		assert.True(t, found, "必须审计留痕")
	})

	t.Run("币种不符（大小写不敏感比对）→ 同款拒发", func(t *testing.T) {
		repo, svc, reg := seedRenewal(990)
		require.NoError(t, fireWebhook(t, svc, reg, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_cc", Type: domain.EventSubscriptionRenewed,
			SubscriptionRef: "sub_1", OrderID: "ord_1", AmountCents: 990, Currency: "USD",
		}))
		assert.Empty(t, repo.setSubs)
		assert.True(t, repo.processed["stripe:evt_cc"])
	})

	t.Run("金额一致（EqualFold 币种）→ 正常续期", func(t *testing.T) {
		repo, svc, reg := seedRenewal(990)
		require.NoError(t, fireWebhook(t, svc, reg, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_ok", Type: domain.EventSubscriptionRenewed,
			SubscriptionRef: "sub_1", OrderID: "ord_1", AmountCents: 990, Currency: "cny",
		}))
		require.Len(t, repo.setSubs, 1, "续期照发")
		assert.True(t, repo.processed["stripe:evt_ok"])
	})

	t.Run("plan 缺失/无价 → 跳过对账照常续期", func(t *testing.T) {
		repo, svc, reg := seedRenewal(0) // 无 plan 行
		require.NoError(t, fireWebhook(t, svc, reg, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_np", Type: domain.EventSubscriptionRenewed,
			SubscriptionRef: "sub_1", OrderID: "ord_1", AmountCents: 12345,
		}))
		require.Len(t, repo.setSubs, 1, "plan 无从对账 → 不阻断续期")
	})

	t.Run("OrderID 为空（waffo/stripe 续期）→ 完全不变（不锚不查）", func(t *testing.T) {
		repo, svc, reg := seedRenewal(1990)
		require.NoError(t, fireWebhook(t, svc, reg, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_e", Type: domain.EventSubscriptionRenewed,
			SubscriptionRef: "sub_1", AmountCents: 990, Currency: "CNY",
		}))
		require.Len(t, repo.setSubs, 1, "无 OrderID 不对账，续期照发")
	})
}

// ---- fix #4：__SET__ 回传短路 ----

func TestUpdateChannelFields_SetMarkerShortCircuit_Fix4(t *testing.T) {
	settings := newFakeChannelSettings()
	settings.saved["billing_channel.cat.private_key"] = "real-secret"
	ch := &schemaChannel{}
	ch.catalogChannel = catalogChannel{name: "cat"}
	svc := newChannelAdminSvc(t, settings, ch)

	_, err := svc.UpdateChannelFields(context.Background(), principal(), "cat", map[string]string{
		"private_key": channelSecretSetMarker, // GET 原样回 PUT 的典型回显
	})
	require.NoError(t, err)
	assert.Equal(t, "real-secret", settings.saved["billing_channel.cat.private_key"],
		"__SET__ 必须与空串同义=保持，哨兵绝不能被存成真密钥")
}

// ---- fix #6：required 有效值规则 + env 可见性 ----

// envSchemaChannel 的有效态来自 fields 快照（AtomicRegistry 重建时换实例），
// envKeys 模拟「进程 env 在供」的字段。
type envSchemaChannel struct {
	name    string
	fields  map[string]string
	envKeys []string
}

func (c *envSchemaChannel) Name() string { return c.name }
func (c *envSchemaChannel) CreateCheckout(_ context.Context, _ CheckoutRequest) (domain.CheckoutSession, error) {
	return domain.CheckoutSession{}, nil
}
func (c *envSchemaChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, nil
}
func (c *envSchemaChannel) ConfigSchema() []FieldSpec {
	return []FieldSpec{
		{Key: "merchant_id", Label: "Merchant ID", Type: FieldTypeText, Required: true},
		{Key: "secret", Label: "Secret", Type: FieldTypeSecret, Required: true},
		{Key: "mode", Label: "模式", Type: FieldTypeSelect,
			Options: []FieldOption{{Value: "test"}, {Value: "prod"}}},
	}
}
func (c *envSchemaChannel) envHas(key string) bool {
	for _, k := range c.envKeys {
		if k == key {
			return true
		}
	}
	return false
}
func (c *envSchemaChannel) ChannelConfig() ChannelConfigInfo {
	secret := c.fields["secret"]
	mask := "env"
	if secret != "" {
		mask = "db:" + secret[:min(4, len(secret))] + "***"
	} else if !c.envHas("secret") {
		mask = ""
	}
	return ChannelConfigInfo{
		Configured:        secret != "" || c.envHas("secret"),
		KeyMasked:         mask,
		WebhookConfigured: true,
	}
}
func (c *envSchemaChannel) EnvProvidedKeys() []string { return c.envKeys }

func TestUpdateChannelFields_RequiredEmptyRule_Fix6(t *testing.T) {
	t.Run("required text 清空且 env 未提供 → 400", func(t *testing.T) {
		settings := newFakeChannelSettings()
		settings.saved["billing_channel.ec.merchant_id"] = "MER_1"
		ch := &envSchemaChannel{name: "ec", fields: map[string]string{"merchant_id": "MER_1"}, envKeys: nil}
		svc := newChannelAdminSvc(t, settings, ch)

		_, err := svc.UpdateChannelFields(context.Background(), principal(), "ec", map[string]string{
			"merchant_id": "",
		})
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, 400, we.Status)
		assert.Contains(t, we.Message, "必填", "清晰文案点名必填字段清空且环境变量未提供")
		assert.Equal(t, "MER_1", settings.saved["billing_channel.ec.merchant_id"], "不得落库清空值")
	})

	t.Run("required text 清空但 env 在供 → 合法（回退 env）", func(t *testing.T) {
		settings := newFakeChannelSettings()
		settings.saved["billing_channel.ec.merchant_id"] = "MER_1"
		ch := &envSchemaChannel{name: "ec", fields: map[string]string{"merchant_id": "MER_1"},
			envKeys: []string{"merchant_id", "secret"}}
		svc := newChannelAdminSvc(t, settings, ch)

		_, err := svc.UpdateChannelFields(context.Background(), principal(), "ec", map[string]string{
			"merchant_id": "",
		})
		require.NoError(t, err)
		assert.Equal(t, "", settings.saved["billing_channel.ec.merchant_id"], "清空落库（运行期回退 env）")
	})

	t.Run("required secret 空串保持现状（=保持，不 400）", func(t *testing.T) {
		settings := newFakeChannelSettings()
		settings.saved["billing_channel.ec.secret"] = "s-1"
		ch := &envSchemaChannel{name: "ec", fields: map[string]string{}}
		svc := newChannelAdminSvc(t, settings, ch)

		_, err := svc.UpdateChannelFields(context.Background(), principal(), "ec", map[string]string{
			"secret": "",
		})
		require.NoError(t, err)
		assert.Equal(t, "s-1", settings.saved["billing_channel.ec.secret"])
	})

	t.Run("卡片暴露 EnvProvided（前端豁免必填高亮）", func(t *testing.T) {
		ch := &envSchemaChannel{name: "ec", fields: map[string]string{},
			envKeys: []string{"secret"}}
		svc := newChannelAdminSvc(t, newFakeChannelSettings(), ch)
		cards, err := svc.ChannelCards(context.Background())
		require.NoError(t, err)
		require.Len(t, cards, 1)
		assert.Equal(t, []string{"secret"}, cards[0].EnvProvided)
	})
}

// ---- fix #7：register-product 币种闸 ----

type currencyGateChannel struct {
	catalogChannel
	currencies []string
}

func (c *currencyGateChannel) Capabilities() ChannelCaps {
	return ChannelCaps{CatalogBased: true, DisplayOrder: 100, Currencies: c.currencies}
}

func TestRegisterChannelProduct_CurrencyGate_Fix7(t *testing.T) {
	t.Run("渠道声明币种不含 plan 币种 → 400（不调渠道 REST）", func(t *testing.T) {
		repo := newFakeRepo()
		seedCatalogPlan(repo)
		repo.plans["pro"] = domain.Plan{Code: "pro", Name: "Pro", Currency: "CNY",
			Limits: map[string]int{"price_monthly_cents": 990, "price_yearly_cents": 9900}}
		reg := NewChannelRegistry()
		ch := &currencyGateChannel{currencies: []string{"USD", "EUR"}}
		ch.catalogChannel = catalogChannel{name: "catalog"}
		reg.Register(ch)
		core := NewBillingService(repo, reg, Config{}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)
		svc := NewBillingAdminService(core, nil, func() time.Time { return testNow }, nil)

		_, err := svc.RegisterChannelProduct(context.Background(), principal(), "catalog", "pro", "monthly")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, 400, we.Status)
		assert.Contains(t, we.Message, "CNY")
		assert.Zero(t, ch.registerCalls, "币种闸必须在渠道 REST 之前")
	})

	t.Run("币种在清单内（大小写不敏感）→ 正常注册", func(t *testing.T) {
		repo := newFakeRepo()
		seedCatalogPlan(repo)
		reg := NewChannelRegistry()
		ch := &currencyGateChannel{currencies: []string{"usd"}}
		ch.catalogChannel = catalogChannel{name: "catalog"}
		reg.Register(ch)
		core := NewBillingService(repo, reg, Config{}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)
		svc := NewBillingAdminService(core, nil, func() time.Time { return testNow }, nil)

		id, err := svc.RegisterChannelProduct(context.Background(), principal(), "catalog", "pro", "monthly")
		require.NoError(t, err)
		assert.Equal(t, "PROD_NEW_pro_monthly", id)
		assert.Equal(t, 1, ch.registerCalls)
	})

	t.Run("AutoRegister 路径同款闸", func(t *testing.T) {
		repo := newFakeRepo()
		seedCatalogPlan(repo)
		ch := &currencyGateChannel{currencies: []string{"EUR"}}
		ch.catalogChannel = catalogChannel{name: "catalog"}
		svc := newCatalogSvc(repo, true, ch)

		_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalMonthly, "catalog")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, 400, we.Status)
		assert.Zero(t, ch.registerCalls)
		assert.Empty(t, repo.orders, "闸在建 pending 订单之前")
	})
}

// ---- fix #8：plan 币种校验（CheckMinorUnit 接线） ----

func TestAdminUpdatePlan_MinorUnitGate_Fix8(t *testing.T) {
	repo := newFakeRepo()
	repo.plans["pro"] = domain.Plan{Code: "pro", Name: "Pro", Currency: "USD", Limits: map[string]int{}}
	svc, ar := newAdminOpsForTest(repo, &metaAuditor{})
	ar.updateFound = true

	for _, bad := range []string{"KWD", "BHD", "JOD"} {
		_, err := svc.AdminUpdatePlan(context.Background(), principal(), "pro", PlanUpdateInput{
			Name: "Pro", Currency: bad, Limits: map[string]int{},
		})
		var we *webx.Error
		require.ErrorAs(t, err, &we, bad)
		assert.Equal(t, 400, we.Status, "三位小数币种必须 400（KWD 曾被静默 10 倍错价）")
		assert.Contains(t, we.Message, bad)
	}

	// 合法币种照常落库。
	view, err := svc.AdminUpdatePlan(context.Background(), principal(), "pro", PlanUpdateInput{
		Name: "Pro", Currency: "JPY", Limits: map[string]int{},
	})
	require.NoError(t, err)
	assert.Equal(t, "JPY", view.Currency)
}

// ---- fix #9：PUT 响应旧卡片 ----

func TestUpdateChannelFields_ReturnsFreshCard_Fix9(t *testing.T) {
	ctx := context.Background()
	ctxRun, cancel := context.WithCancel(ctx)
	defer cancel()

	settings := newFakeChannelSettings()
	source := func(context.Context) (map[string]map[string]string, error) {
		return settings.BillingChannelFields(ctx)
	}
	registry := NewAtomicRegistry(ctxRun, nil, source, map[string]func(map[string]string) (PaymentChannel, error){
		"ec": func(f map[string]string) (PaymentChannel, error) {
			return &envSchemaChannel{name: "ec", fields: f}, nil
		},
	}, time.Hour)

	core := NewBillingService(newFakeRepo(), registry, Config{}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil)
	svc := NewBillingAdminService(core, nil, func() time.Time { return testNow }, nil).
		WithChannelSettings(settings).WithChannelRefresher(registry)

	cards, err := svc.ChannelCards(ctx)
	require.NoError(t, err)
	require.Len(t, cards, 1)
	assert.False(t, cards[0].Configured, "保存前 env 无供 → 未配置")

	card, err := svc.UpdateChannelFields(ctx, principal(), "ec", map[string]string{
		"secret": "sk_new_123456",
	})
	require.NoError(t, err)
	assert.True(t, card.Configured, "fix #9：响应卡必须来自 RefreshNow 后的新实例（旧实例会显示未配置）")
	assert.Equal(t, "db:sk_n***", card.KeyMasked, "新实例的掩码反映 DB 密钥")
	assert.Equal(t, "__SET__", card.Values["secret"])
	assert.Equal(t, "db", card.ConfigSource)
}

// ---- fix #10：sealer 未配置 → 503 ----

func TestUpdateChannelFields_SealerMissing503_Fix10(t *testing.T) {
	settings := newFakeChannelSettings()
	settings.setErr = fmt.Errorf("settings: sensitive key requires a configured sealer (PLOYKIT_SEAL_KEY): %w", sealx.ErrNoKey)
	ch := &schemaChannel{}
	ch.catalogChannel = catalogChannel{name: "cat"}
	svc := newChannelAdminSvc(t, settings, ch)

	_, err := svc.UpdateChannelFields(context.Background(), principal(), "cat", map[string]string{
		"merchant_id": "MER_2",
	})
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 503, we.Status, "seal key 未配置是运维问题不是服务缺陷：503 + 修复指引")
	assert.Contains(t, we.Message, "PLOYKIT_SEAL_KEY")

	// 非 sealer 类错误仍走 500 包装。
	settings.setErr = errors.New("db down")
	_, err = svc.UpdateChannelFields(context.Background(), principal(), "cat", map[string]string{
		"merchant_id": "MER_2",
	})
	require.Error(t, err)
	var we2 *webx.Error
	if errors.As(err, &we2) {
		assert.NotEqual(t, 503, we2.Status)
	}
}

// ---- fix #12（hermetic 形态）：注册并发双击的服务层语义 ----

func TestRegisterChannelProduct_AtomicExistedShortCircuit_Fix12(t *testing.T) {
	repo := newFakeRepo()
	seedCatalogPlan(repo)
	synced := testNow
	repo.chanProducts = map[string]domain.ChannelProduct{
		"catalog/pro/monthly": {Channel: "catalog", PlanCode: "pro", Interval: domain.IntervalMonthly,
			ChannelProductID: "PROD_WINNER", SyncedPriceCents: 990, SyncedAt: &synced},
	}
	reg := NewChannelRegistry()
	ch := &catalogChannel{name: "catalog"}
	reg.Register(ch)
	core := NewBillingService(repo, reg, Config{}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)
	svc := NewBillingAdminService(core, nil, func() time.Time { return testNow }, nil)

	id, err := svc.RegisterChannelProduct(context.Background(), principal(), "catalog", "pro", "monthly")
	require.NoError(t, err)
	assert.Equal(t, "PROD_WINNER", id, "已有映射（并发赢家已落）→ 直接返回现有 id")
	assert.Zero(t, ch.registerCalls, "不再调渠道 REST")
}

// ---- fix #13：OrderedNames 零值防御 ----

func TestOrderedNames_ZeroDisplayOrderDefended_Fix13(t *testing.T) {
	reg := NewChannelRegistry()
	reg.Register(&atomicTestChannel{name: "zero-cap", caps: &ChannelCaps{DisplayOrder: 0}})
	reg.Register(&atomicTestChannel{name: "explicit", caps: &ChannelCaps{DisplayOrder: 300}})

	assert.Equal(t, []string{"explicit", "zero-cap"}, reg.OrderedNames(),
		"DisplayOrder==0（未设置的零值）视同 DefaultChannelDisplayOrder(500)，不得跳队到 stripe(200) 之前")
}

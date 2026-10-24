package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/sealx"
	"github.com/haozing/ploykit/platform/webx"
)

// ChannelCard is one channel's admin billing-page card (BC-6 API contract —
// field names are shared with the frontend, do not rename).
type ChannelCard struct {
	Name              string            `json:"name"`
	Configured        bool              `json:"configured"`
	KeyMasked         string            `json:"key_masked"`
	WebhookConfigured bool              `json:"webhook_configured"`
	Capabilities      ChannelCaps       `json:"capabilities"`
	Schema            []FieldSpec       `json:"schema"`
	Values            map[string]string `json:"values"`
	ConfigSource      string            `json:"config_source"` // "db" | "env" | ""
	// EnvProvided lists the schema keys currently supplied by process env
	// (ChannelEnvViewer, billing fix #6): the frontend exempts them from
	// required-field highlighting — clearing the DB row falls back to env.
	EnvProvided []string `json:"env_provided,omitempty"`
}

// channelSecretSetMarker is what a secret field reads back as once stored
// (BC-5): presence only, never the value.
const channelSecretSetMarker = "__SET__"

const (
	channelConfigSourceDB  = "db"
	channelConfigSourceEnv = "env"
)

// ChannelCatalogRow is one registered channel product (BC-7) joined with the
// plan's current DB price so the UI can flag drift.
type ChannelCatalogRow struct {
	Channel          string     `json:"channel"`
	PlanCode         string     `json:"plan_code"`
	Interval         string     `json:"interval"`
	ChannelProductID string     `json:"channel_product_id"`
	SyncedPriceCents int        `json:"synced_price_cents"`
	PlanPriceCents   int        `json:"plan_price_cents"`
	SyncedAt         *time.Time `json:"synced_at"`
}

// ChannelCatalogPlan is the plans list the UI cross-joins client-side to
// render unregistered slots.
type ChannelCatalogPlan struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	Currency     string `json:"currency"`
	MonthlyCents int    `json:"monthly_cents"`
	YearlyCents  int    `json:"yearly_cents"`
}

type ChannelCatalog struct {
	Rows  []ChannelCatalogRow  `json:"rows"`
	Plans []ChannelCatalogPlan `json:"plans"`
}

// WithChannelSettings wires the settings store backing billing_channel.* keys
// (BC-5). Without it the channel cards render env-only (no values, no PUT).
func (s *BillingAdminService) WithChannelSettings(store ChannelSettingsStore) *BillingAdminService {
	s.channelSettings = store
	return s
}

// WithChannelRefresher wires the hot-reload trigger called right after a
// successful PUT, so the response card reflects the freshly built channel.
func (s *BillingAdminService) WithChannelRefresher(r ChannelRefresher) *BillingAdminService {
	s.refresher = r
	return s
}

func (s *BillingAdminService) channelFields(ctx context.Context) (map[string]map[string]string, error) {
	if s.channelSettings == nil {
		return map[string]map[string]string{}, nil
	}
	return s.channelSettings.BillingChannelFields(ctx)
}

// ChannelCards assembles the admin billing-channels page: one card per
// REGISTERED channel in priority order (OrderedChannels — F16: never
// registered = no card). Disabled stubs (unconfigured paypal/waffo/stripe
// factories return app.DisabledChannel) are registered and therefore DO get a
// card — configured:false, schema rendered — so credentials can be pasted
// without env bootstrapping (the BC-5 chicken-and-egg fix); values come from
// the DB namespace with secrets masked to __SET__.
func (s *BillingAdminService) ChannelCards(ctx context.Context) ([]ChannelCard, error) {
	fields, err := s.channelFields(ctx)
	if err != nil {
		return nil, err
	}
	chs := s.core.channels.OrderedChannels()
	cards := make([]ChannelCard, 0, len(chs))
	for _, ch := range chs {
		cards = append(cards, s.channelCard(ch, fields[ch.Name()]))
	}
	return cards, nil
}

// channelCard builds one card. dbFields nil = no billing_channel.<name>.*
// rows → config_source "env" when the channel is registered (it always is
// here — cards come from the live registry).
func (s *BillingAdminService) channelCard(ch PaymentChannel, dbFields map[string]string) ChannelCard {
	card := ChannelCard{
		Name:         ch.Name(),
		Configured:   true,
		KeyMasked:    keyMaskUnavailable,
		Values:       map[string]string{},
		ConfigSource: channelConfigSourceEnv,
	}
	if len(dbFields) > 0 {
		card.ConfigSource = channelConfigSourceDB
	}
	if viewer, ok := ch.(ChannelCapabilityViewer); ok {
		card.Capabilities = viewer.Capabilities()
	} else {
		card.Capabilities = ChannelCaps{DisplayOrder: DefaultChannelDisplayOrder}
	}
	if schemaViewer, ok := ch.(ChannelSchemaViewer); ok {
		card.Schema = schemaViewer.ConfigSchema()
	}
	for _, spec := range card.Schema {
		v, has := dbFields[spec.Key]
		switch {
		case !has:
			card.Values[spec.Key] = ""
		case spec.Type == FieldTypeSecret:
			if v != "" {
				card.Values[spec.Key] = channelSecretSetMarker
			} else {
				card.Values[spec.Key] = ""
			}
		default:
			card.Values[spec.Key] = v
		}
	}
	if viewer, ok := ch.(ChannelConfigViewer); ok {
		info := viewer.ChannelConfig()
		card.Configured = info.Configured
		card.WebhookConfigured = info.WebhookConfigured
		if info.KeyMasked != "" {
			card.KeyMasked = info.KeyMasked
		}
	}
	if envViewer, ok := ch.(ChannelEnvViewer); ok {
		if keys := envViewer.EnvProvidedKeys(); len(keys) > 0 {
			card.EnvProvided = keys
		}
	}
	if !card.Configured && card.KeyMasked == keyMaskUnavailable {
		card.KeyMasked = keyNotConfigured
	}
	return card
}

func actorLabelOf(p *webx.Principal) string {
	if p == nil {
		return "admin"
	}
	if p.Email != "" {
		return p.Email
	}
	if p.UserID != "" {
		return p.UserID
	}
	return "admin"
}

const channelFieldValueLimit = 8192

// UpdateChannelFields persists one channel's edited fields as
// billing_channel.<name>.<field> rows (BC-5): unknown field names 400; a
// secret submitted as the empty string OR the __SET__ masked read-back keeps
// the stored value (billing fix #4 — a GET→PUT round-trip must never store
// the marker as a literal key); text/select fields overwrite (empty = clear,
// except a required field cleared while env does not provide it — 400, fix
// #6). ALL fields are validated before the first write and the writes land in
// one transaction via SetMany (fix #11 — a mid-loop failure used to leave a
// half-saved channel). After the write the channel set is rebuilt
// synchronously when a refresher is wired, and the response card is rebuilt
// from the freshly-Get-ed channel instance + a fresh DB read (fix #9 — the
// old card echoed the pre-save instance's mask/status).
func (s *BillingAdminService) UpdateChannelFields(ctx context.Context, actor *webx.Principal, channel string, fields map[string]string) (ChannelCard, error) {
	if s.channelSettings == nil {
		return ChannelCard{}, webx.NewError(503, webx.CodeUnavailable, "渠道设置存储未接线（channel settings store not wired）")
	}
	ch, ok := s.core.channels.Get(channel)
	if !ok {
		return ChannelCard{}, webx.NewNotFound("unknown payment channel: " + channel)
	}
	schemaViewer, ok := ch.(ChannelSchemaViewer)
	if !ok {
		return ChannelCard{}, webx.NewValidation("payment channel does not support admin configuration: " + channel)
	}
	specByKey := make(map[string]FieldSpec, len(schemaViewer.ConfigSchema()))
	for _, spec := range schemaViewer.ConfigSchema() {
		specByKey[spec.Key] = spec
	}
	// 「清空=回退 env」豁免（fix #6）：required 字段清空时，环境变量在供的键合法。
	envProvided := map[string]bool{}
	if envViewer, ok := ch.(ChannelEnvViewer); ok {
		for _, k := range envViewer.EnvProvidedKeys() {
			envProvided[k] = true
		}
	}

	// Pass 1 — validate everything, collect writes; nothing is persisted until
	// every submitted field passed (fix #11).
	writes := make(map[string]string, len(fields))
	for key, raw := range fields {
		spec, ok := specByKey[key]
		if !ok {
			return ChannelCard{}, webx.NewValidation(fmt.Sprintf("渠道 %s 无配置字段 %q", channel, key))
		}
		value := strings.TrimSpace(raw)
		if len(value) > channelFieldValueLimit {
			return ChannelCard{}, webx.NewValidation(fmt.Sprintf("字段 %s 值过长（上限 %d 字符）", key, channelFieldValueLimit))
		}
		if spec.Type == FieldTypeSecret && (value == "" || value == channelSecretSetMarker) {
			continue // keep stored value（__SET__ 是读回掩码，不是新密钥——fix #4）
		}
		if spec.Type == FieldTypeSelect && value != "" && len(spec.Options) > 0 && !fieldOptionHas(spec.Options, value) {
			return ChannelCard{}, webx.NewValidation(fmt.Sprintf("字段 %s 的值必须是 %s", key, fieldOptionList(spec.Options)))
		}
		if value == "" && spec.Required && spec.Type != FieldTypeSecret && !envProvided[key] {
			return ChannelCard{}, webx.NewValidation(fmt.Sprintf(
				"字段 %s 为必填字段，清空且环境变量未提供（如需回退环境变量，请配置对应 env 后再清空）", key))
		}
		writes[ChannelSettingsKey(channel, key)] = value
	}

	// Pass 2 — one transactional write (fix #11); a missing seal key is an
	// operator problem, not a server bug → 503 with the fix-it hint (fix #10).
	if err := s.channelSettings.SetMany(ctx, writes, actorLabelOf(actor)); err != nil {
		if errors.Is(err, sealx.ErrNoKey) {
			return ChannelCard{}, webx.NewError(http.StatusServiceUnavailable, webx.CodeUnavailable,
				"PLOYKIT_SEAL_KEY 未配置，无法保存凭据：请配置该环境变量并重启后重试（明文凭据一律不入库）")
		}
		return ChannelCard{}, fmt.Errorf("save channel fields: %w", err)
	}
	if s.refresher != nil {
		if err := s.refresher.RefreshNow(ctx); err != nil {
			s.log.Warn("channel refresh after save failed; the next poll picks the change up", "channel", channel, "err", err)
		}
	}
	if s.core.auditor != nil {
		s.core.auditor.Record(ctx, nil, actor, "admin.billing_channel_update", "billing_channel", channel,
			map[string]any{"fields": fieldKeysSorted(fields)}) // keys only — values are credentials
	}
	// fix #9：RefreshNow 成功换指针后，从注册表重新 Get 新实例，卡片反映新状态
	// （新掩码/新 Configured），而不是被替换前的旧实例。
	if fresh, ok := s.core.channels.Get(channel); ok {
		ch = fresh
	}
	dbFields, err := s.channelFields(ctx)
	if err != nil {
		return ChannelCard{}, err
	}
	return s.channelCard(ch, dbFields[channel]), nil
}

func fieldOptionHas(opts []FieldOption, value string) bool {
	for _, o := range opts {
		if o.Value == value {
			return true
		}
	}
	return false
}

func fieldOptionList(opts []FieldOption) string {
	parts := make([]string, len(opts))
	for i, o := range opts {
		parts[i] = o.Value
	}
	return strings.Join(parts, "/")
}

func fieldKeysSorted(fields map[string]string) []string {
	keys := make([]string, 0, len(fields))
	for k := range fields {
		keys = append(keys, k)
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}

// ChannelCatalog lists every registered channel product joined with the
// plan's current DB price, plus the plan list for the UI to render
// unregistered slots (BC-7 admin page).
func (s *BillingAdminService) ChannelCatalog(ctx context.Context) (ChannelCatalog, error) {
	mappings, err := s.core.repo.ListChannelProducts(ctx)
	if err != nil {
		return ChannelCatalog{}, err
	}
	plans, err := s.core.repo.ListPlans(ctx)
	if err != nil {
		return ChannelCatalog{}, err
	}
	planByCode := make(map[string]domain.Plan, len(plans))
	out := ChannelCatalog{Rows: []ChannelCatalogRow{}, Plans: make([]ChannelCatalogPlan, 0, len(plans))}
	for _, p := range plans {
		planByCode[p.Code] = p
		out.Plans = append(out.Plans, ChannelCatalogPlan{
			Code: p.Code, Name: p.Name, Currency: p.Currency,
			MonthlyCents: PlanPriceCents(p, domain.IntervalMonthly),
			YearlyCents:  PlanPriceCents(p, domain.IntervalYearly),
		})
	}
	for _, m := range mappings {
		row := ChannelCatalogRow{
			Channel: m.Channel, PlanCode: m.PlanCode, Interval: string(m.Interval),
			ChannelProductID: m.ChannelProductID, SyncedPriceCents: m.SyncedPriceCents,
			SyncedAt: m.SyncedAt,
		}
		if plan, ok := planByCode[m.PlanCode]; ok {
			row.PlanPriceCents = PlanPriceCents(plan, m.Interval)
		}
		out.Rows = append(out.Rows, row)
	}
	return out, nil
}

// parseCatalogInterval converts the admin-layer interval param; subscription
// catalogs are monthly/yearly (one_time packs are a BC-8 open question,
// rejected until a channel declares support).
func parseCatalogInterval(v string) (domain.BillingInterval, bool) {
	switch domain.BillingInterval(v) {
	case domain.IntervalMonthly, domain.IntervalYearly:
		return domain.BillingInterval(v), true
	}
	return "", false
}

// RegisterChannelProduct creates (or returns the existing) channel-side
// product for plan+interval on a catalog-based channel (BC-7, F4): the
// one-off create-products script becomes this admin button. Idempotent on the
// (channel, plan_code, interval) mapping.
func (s *BillingAdminService) RegisterChannelProduct(ctx context.Context, actor *webx.Principal, channel, planCode, interval string) (string, error) {
	iv, ok := parseCatalogInterval(interval)
	if !ok {
		return "", webx.NewValidation("interval must be monthly or yearly")
	}
	ch, ok := s.core.channels.Get(channel)
	if !ok {
		return "", webx.NewNotFound("unknown payment channel: " + channel)
	}
	reg, ok := ch.(ProductRegistrar)
	if !ok {
		return "", webx.NewError(400, CodeChannelProductUnsupported,
			"payment channel does not support product registration: "+channel)
	}
	plan, ok, err := s.core.repo.GetPlan(ctx, planCode)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", webx.NewNotFound("plan not found: " + planCode)
	}
	// billing fix #7：币种闸在渠道 REST 之前——CNY 计划撞上仅收 USD 的渠道时，
	// 注册必然白做且结账必 400，直接以清晰文案拒绝。
	if currency := planCurrency(plan, s.core.cfg.Currency); !channelCurrencyAllowed(ch, currency) {
		return "", errChannelCurrencyUnsupported(channel, currency, planCode)
	}
	if existing, found, err := s.core.repo.GetChannelProduct(ctx, channel, planCode, iv); err != nil {
		return "", err
	} else if found {
		return existing.ChannelProductID, nil
	}
	amount := PlanPriceCents(plan, iv)
	if amount <= 0 {
		return "", webx.NewValidation("plan is not priced for this interval: " + planCode)
	}
	// billing fix #12：check+register+upsert 在 per-(channel,plan,interval) 的
	// pg_advisory_xact_lock 内串行（渠道 REST 在锁内执行）——并发双击只有一次
	// 真正调渠道注册，败者直接拿到胜者落库的映射。
	id, existed, err := s.core.repo.RegisterChannelProductAtomic(ctx, channel, planCode, iv,
		func(ctx context.Context) (string, error) { return reg.RegisterProduct(ctx, plan, iv) },
		amount, s.now())
	if err != nil {
		return "", fmt.Errorf("register product on %s: %w", channel, err)
	}
	if existed {
		return id, nil // 并发赢家已完成注册：幂等返回，不再审计
	}
	if s.core.auditor != nil {
		s.core.auditor.Record(ctx, nil, actor, "admin.billing_channel_register_product", "billing_channel", channel,
			map[string]any{"plan": planCode, "interval": string(interval), "channel_product_id": id})
	}
	return id, nil
}

// SyncChannelPrice pushes the plan's current DB price to a registered channel
// product (BC-7 改价联动) and stamps synced_price_cents/synced_at so the
// catalog view can detect drift.
func (s *BillingAdminService) SyncChannelPrice(ctx context.Context, actor *webx.Principal, channel, planCode, interval string) (int, error) {
	iv, ok := parseCatalogInterval(interval)
	if !ok {
		return 0, webx.NewValidation("interval must be monthly or yearly")
	}
	ch, ok := s.core.channels.Get(channel)
	if !ok {
		return 0, webx.NewNotFound("unknown payment channel: " + channel)
	}
	reg, ok := ch.(ProductRegistrar)
	if !ok {
		return 0, webx.NewError(400, CodeChannelProductUnsupported,
			"payment channel does not support product sync: "+channel)
	}
	mapping, found, err := s.core.repo.GetChannelProduct(ctx, channel, planCode, iv)
	if err != nil {
		return 0, err
	}
	if !found {
		return 0, webx.NewNotFound("channel product not registered: " + channel + "/" + planCode + "/" + string(interval))
	}
	plan, ok, err := s.core.repo.GetPlan(ctx, planCode)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, webx.NewNotFound("plan not found: " + planCode)
	}
	amount := PlanPriceCents(plan, iv)
	if amount <= 0 {
		return 0, webx.NewValidation("plan is not priced for this interval: " + planCode)
	}
	if err := reg.SyncPrice(ctx, mapping.ChannelProductID, plan, iv); err != nil {
		return 0, fmt.Errorf("sync price on %s: %w", channel, err)
	}
	now := s.now()
	mapping.SyncedPriceCents = amount
	mapping.SyncedAt = &now
	if err := s.core.repo.UpsertChannelProduct(ctx, mapping); err != nil {
		return 0, err
	}
	if s.core.auditor != nil {
		s.core.auditor.Record(ctx, nil, actor, "admin.billing_channel_sync_price", "billing_channel", channel,
			map[string]any{"plan": planCode, "interval": string(interval), "price_cents": amount})
	}
	return amount, nil
}

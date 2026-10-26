package app

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type Clock func() time.Time

type Auditor interface {
	Record(ctx context.Context, workspaceID *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any)
}

type CheckoutRequest struct {
	Order domain.Order
	SuccessURL string
	CancelURL string // 目录型渠道可忽略，但须在 Capabilities().SupportsCancelURL=false 声明，不许静默
	BuyerEmail string // 渠道预填买家邮箱；空=不预填
	Locale     string // 站点语言透传收银台（如 "en"/"zh"）；空=渠道默认

	// ChannelProductID is the catalog product the service resolved for this
	// order from the billing_channel_products mapping (BC-7). Catalog-based
	// channels must prefer it; empty = the channel falls back to whatever
	// static product ids it was configured with (env-only legacy wiring).
	ChannelProductID string
}

type PaymentChannel interface {
	Name() string

	CreateCheckout(ctx context.Context, req CheckoutRequest) (domain.CheckoutSession, error)

	ParseWebhook(ctx context.Context, req WebhookRequest) (domain.PaymentEvent, error)
}

type WebhookRequest struct {
	Header map[string][]string
	Body   []byte
}

// ChannelSet is the read-side channel registry BillingService depends on.
// Two implementations: *ChannelRegistry (products wire channels once at boot,
// zero-change for existing main.go wiring) and *AtomicRegistry (BC-5 hot
// reload — DB credentials rebuilt on a poll, pointer swapped atomically).
//
// OrderedNames lists only ACTIVE channels (a channel whose ChannelConfig
// reports !Configured — e.g. a *DisabledChannel stub — is filtered out): it
// feeds /config billing_channels, checkout and the BillingConfig view, where
// an unconfigured channel must not appear. OrderedChannels returns the full
// registered set INCLUDING disabled placeholders — the admin billing-channels
// page enumerates it so unconfigured channels still get a card to paste
// credentials into.
type ChannelSet interface {
	Get(name string) (PaymentChannel, bool)
	OrderedNames() []string
	OrderedChannels() []PaymentChannel
}

type ChannelRegistry struct {
	channels map[string]PaymentChannel
}

var _ ChannelSet = (*ChannelRegistry)(nil)

func NewChannelRegistry() *ChannelRegistry {
	return &ChannelRegistry{channels: make(map[string]PaymentChannel)}
}

func (r *ChannelRegistry) Register(ch PaymentChannel) {
	r.channels[ch.Name()] = ch
}

func (r *ChannelRegistry) Get(name string) (PaymentChannel, bool) {
	ch, ok := r.channels[name]
	return ch, ok
}

// DefaultChannelDisplayOrder is the DisplayOrder assumed for channels that do
// not implement ChannelCapabilityViewer — unsorted channels sink below the
// framework defaults (stripe 200) but stay above manual (900).
const DefaultChannelDisplayOrder = 500

// OrderedNames returns ACTIVE channel names sorted by (DisplayOrder asc,
// name asc) so /config billing_channels is a priority list the frontend can
// take as-is (F18): first entry = recommended channel, no product-side
// re-sorting. Channels whose ChannelConfigViewer reports !Configured
// (disabled stubs) are excluded — see orderedNamesOf.
func (r *ChannelRegistry) OrderedNames() []string {
	return orderedNamesOf(r.channels)
}

// OrderedChannels returns every registered channel (disabled stubs included)
// in the same (DisplayOrder asc, name asc) order — the admin channel-cards
// page enumerates this.
func (r *ChannelRegistry) OrderedChannels() []PaymentChannel {
	return orderedChannelsOf(r.channels)
}

// CancelTiming declares when a channel-side subscription cancel takes effect
// (LC-4). It is channel knowledge, so it lives here — next to the rest of the
// capability declaration — instead of being hardcoded in the cancel flows:
//
//   - CancelTimingImmediate: the channel revokes access right away, so the
//     local plan flips to free at once (same local path as admin cancel).
//   - CancelTimingPeriodEnd: the channel honors the already-paid period, so
//     the local plan stays untouched and only cancel_requested_at is set; the
//     existing plan-expiry machinery collects the workspace when the period
//     runs out without a renewal.
//   - "" (empty): timing unknown. A channel that implements
//     SubscriptionCanceller but declares no timing is treated as period-end
//     (the promise-preserving default: never cut a paying user short).
//
// A channel without SubscriptionCanceller never reads this field.
type CancelTiming string

const (
	CancelTimingImmediate CancelTiming = "immediate"
	CancelTimingPeriodEnd CancelTiming = "period_end"
)

// ChannelCaps is a channel's declared shape of difference. The registry and
// product frontends key ordering off DisplayOrder; CatalogBased/SupportsCancelURL
// document behavior the adapter absorbs (F1/F3): a channel that ignores
// CancelURL must say so here instead of silently dropping the parameter.
type ChannelCaps struct {
	CatalogBased      bool         `json:"catalog_based"`        // 目录型（waffo/paypal 需预注册商品）vs 临时定价型（stripe price_data）
	SupportsCancelURL bool         `json:"supports_cancel_url"`
	DisplayOrder      int          `json:"display_order"`       // /config billing_channels 排序；stripe 建议 200、manual 900、waffo 将来 100
	Currencies        []string     `json:"currencies"`          // 空=不声明限制；非空时 RegisterProduct / AutoRegister 在调渠道 REST 前校验 plan 币种 ∈ 清单（不符 400，修复「CNY 计划注册成功但结账必 400」）
	CancelTiming      CancelTiming `json:"cancel_timing"`       // 取消时序（LC-4）；空=未声明（有 canceller 时按 period_end 对待）
}

// ChannelCapabilityViewer is the optional capability interface channels
// implement to declare their caps. Channels that don't implement it get
// DefaultChannelDisplayOrder in OrderedNames.
type ChannelCapabilityViewer interface {
	Capabilities() ChannelCaps
}

// ChannelEnvViewer is the optional interface channels implement to expose
// which of their ConfigSchema keys are currently provided by process env
// (billing fix #6). Two consumers:
//   - UpdateChannelFields: clearing a required text/select field is a 400
//     unless the key is env-provided (empty DB row = fall back to env, a
//     legitimate "unconfigure the override" move, not a misconfiguration);
//   - the admin card (ChannelCard.EnvProvided): the frontend can exempt those
//     fields from required-field highlighting.
//
// The returned keys are ConfigSchema field keys, not env var names.
type ChannelEnvViewer interface {
	EnvProvidedKeys() []string
}

// ProductRegistrar is the optional interface catalog-based channels (waffo,
// paypal) implement so the framework can create/sync their product catalog
// instead of per-product one-off scripts (BC-7, F4). RegisterProduct creates
// the channel-side product for the plan+interval and returns its channel
// product id; SyncPrice pushes a price change to an existing product.
type ProductRegistrar interface {
	RegisterProduct(ctx context.Context, plan domain.Plan, interval domain.BillingInterval) (channelProductID string, err error)
	SyncPrice(ctx context.Context, channelProductID string, plan domain.Plan, interval domain.BillingInterval) error
}

// StaticProductResolver is the adapter-side static product fallback for
// catalog-based channels: when the billing_channel_products table has no row
// for (channel, plan, interval) and AutoRegisterCatalog is off, the service
// uses the adapter's statically configured product id (env / channel fields)
// BEFORE failing. Without this seam the adapter's own fallback promise (waffo
// channel.go: "env-only 老接法不断") is dead code — the service 400s first,
// which is exactly what happened live (shuijing prod 2026-10-26: env products
// present, checkout still refused with "product not registered").
type StaticProductResolver interface {
	// StaticProductID returns the statically configured channel product for
	// the plan+interval, "" when this interval has no static product.
	StaticProductID(planCode string, interval domain.BillingInterval) string
}

type Repo interface {
	CreateOrder(ctx context.Context, o domain.Order) (domain.Order, error)
	GetOrder(ctx context.Context, id string) (domain.Order, bool, error)
	ListOrdersByWorkspace(ctx context.Context, workspaceID string, limit int) ([]domain.Order, error)

	UpdateOrderStatus(ctx context.Context, id string, from, to domain.OrderStatus, now time.Time) error

	// CancelOrder is the cancel transition that also stamps canceled_by
	// ('user' / 'admin' / 'expiry' — migration 051). Only 'expiry' rows are
	// revivable by ReviveOrderAfterExpiry; 'user'/'admin'/NULL are terminal.
	CancelOrder(ctx context.Context, id string, from domain.OrderStatus, canceledBy string, now time.Time) error

	// ReviveOrderAfterExpiry attempts the single sanctioned exit from canceled
	// (canceled → paid) when canceled_by = 'expiry' — a payment that actually
	// arrived beats the sweeper's guess. false = not revivable (user/admin
	// canceled, or a pre-051 NULL row), the caller keeps ignoring the event.
	ReviveOrderAfterExpiry(ctx context.Context, id string, now time.Time) (bool, error)

	FailOrder(ctx context.Context, o domain.Order, e domain.PaymentEvent, emit func(tx pgx.Tx) error, now time.Time) error

	PayOrder(ctx context.Context, id string, emit func(tx pgx.Tx) error, now time.Time) error
	SetOrderChannelRefAndExpiry(ctx context.Context, id, channelRef string, expiresAt time.Time) error
	FindOrderByChannelRef(ctx context.Context, channel, channelRef string) (domain.Order, bool, error)

	SetOrderPaymentIntentRef(ctx context.Context, orderID, paymentIntentRef string) error

	FindOrderByPaymentIntent(ctx context.Context, paymentIntentRef string) (domain.Order, bool, error)

	InsertPaymentEvent(ctx context.Context, e domain.PaymentEvent) (isNew bool, err error)
	MarkEventProcessed(ctx context.Context, channel, channelEventID string) error

	MarkEventError(ctx context.Context, channel, channelEventID, processErr string) error

	ListPlans(ctx context.Context) ([]domain.Plan, error)
	GetPlan(ctx context.Context, code string) (domain.Plan, bool, error)

	ChangeWorkspacePlan(ctx context.Context, workspaceID, toPlan, actor, reason string, now time.Time, inTx func(tx pgx.Tx, from string) error) error
	GetWorkspacePlan(ctx context.Context, workspaceID string) (string, error)

	SetWorkspaceSubscription(ctx context.Context, workspaceID, subscriptionRef string, expiresAt, now time.Time) error

	GetWorkspaceSubscription(ctx context.Context, workspaceID string) (ref string, ok bool, err error)

	FindWorkspaceBySubscription(ctx context.Context, subscriptionRef string) (workspaceID, planCode string, ok bool, err error)

	// LC-4 self-serve cancel bookkeeping (migration 053):
	// workspace.cancel_requested_at marks a user-requested cancel that has not
	// resolved locally yet — either the channel stops at period end (plan
	// collected by the expiry sweeper once the period runs out) or the channel
	// has no canceller API and an operator must finish it in the channel
	// console (the admin cancel-requests queue lists these rows). Set on a
	// workspace that re-subscribes is cleared by the checkout-completed path.
	SetWorkspaceCancelRequested(ctx context.Context, workspaceID string, now time.Time) error

	GetWorkspaceCancelRequested(ctx context.Context, workspaceID string) (requestedAt time.Time, ok bool, err error)

	// GetWorkspacePlanExpiry reads workspace.plan_expires_at — the end of the
	// currently paid period. It feeds the renews_at field of the subscription
	// view (R5): a period-end cancel keeps access until this timestamp; a
	// NULL (perpetual/manual plan) surfaces as no renews_at.
	GetWorkspacePlanExpiry(ctx context.Context, workspaceID string) (expiresAt time.Time, ok bool, err error)

	ClearWorkspaceCancelRequested(ctx context.Context, workspaceID string) error

	ListCancelRequestedWorkspaces(ctx context.Context, limit int) ([]CancelRequestView, error)

	LatestPaidOrderInterval(ctx context.Context, workspaceID string) (interval string, ok bool, err error)

	ExpireDueWorkspaces(ctx context.Context, now time.Time, limit int) ([]ExpiredWorkspace, error)

	ExpireStaleOrders(ctx context.Context, now time.Time, limit int) ([]ExpiredOrder, error)

	InsertOverageOrder(ctx context.Context, o domain.Order) (order domain.Order, created bool, err error)

	ListMeteredWorkspaces(ctx context.Context, limit int) ([]MeteredWorkspace, error)

	// BC-7 catalog mapping: resolve/register/list billing_channel_products.
	GetChannelProduct(ctx context.Context, channel, planCode string, interval domain.BillingInterval) (domain.ChannelProduct, bool, error)
	UpsertChannelProduct(ctx context.Context, p domain.ChannelProduct) error
	ListChannelProducts(ctx context.Context) ([]domain.ChannelProduct, error)

	// RegisterChannelProductAtomic wraps mapping check + register callback +
	// upsert under a per-(channel, plan, interval) advisory lock (billing fix
	// #12): concurrent double-clicks serialize, the loser gets existed=true.
	// The callback performs the channel REST inside the lock — see the pgrepo
	// implementation note for the accepted trade-off.
	RegisterChannelProductAtomic(ctx context.Context, channel, planCode string, interval domain.BillingInterval,
		register func(ctx context.Context) (channelProductID string, err error),
		syncedPriceCents int, syncedAt time.Time) (channelProductID string, existed bool, err error)
}

type MeteredWorkspace struct {
	WorkspaceID   string
	PlanCode      string
	Limits        map[string]int
	PlanExpiresAt *time.Time
}

type ExpiredWorkspace struct {
	WorkspaceID string
	FromPlan    string
}

// CancelRequestView is one row of the admin operator queue (LC-4): a workspace
// whose user requested a cancel that still needs operator attention or is
// waiting out the paid period.
type CancelRequestView struct {
	WorkspaceID     string    `json:"workspace_id"`
	RequestedAt     time.Time `json:"requested_at"`
	PlanCode        string    `json:"plan"`
	SubscriptionRef string    `json:"subscription_ref"`
}

// ExpiredOrder is one pending order swept to canceled because its checkout
// session expiry (order.expires_at) has passed (F15: channels like waffo
// expire sessions with zero callbacks).
type ExpiredOrder struct {
	ID          string
	WorkspaceID string
}

var ErrDuplicate = errors.New("duplicate")

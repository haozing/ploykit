package app

import (
	"context"
	"errors"
	"sort"
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
	Order      domain.Order
	SuccessURL string
	CancelURL  string // 目录型渠道可忽略，但须在 Capabilities().SupportsCancelURL=false 声明，不许静默
	BuyerEmail string // 渠道预填买家邮箱；空=不预填
	Locale     string // 站点语言透传收银台（如 "en"/"zh"）；空=渠道默认
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

type ChannelRegistry struct {
	channels map[string]PaymentChannel
}

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

// OrderedNames returns channel names sorted by (DisplayOrder asc, name asc)
// so /config billing_channels is a priority list the frontend can take as-is
// (F18): first entry = recommended channel, no product-side re-sorting.
func (r *ChannelRegistry) OrderedNames() []string {
	type entry struct {
		name  string
		order int
	}
	entries := make([]entry, 0, len(r.channels))
	for name, ch := range r.channels {
		order := DefaultChannelDisplayOrder
		if viewer, ok := ch.(ChannelCapabilityViewer); ok {
			order = viewer.Capabilities().DisplayOrder
		}
		entries = append(entries, entry{name: name, order: order})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].order != entries[j].order {
			return entries[i].order < entries[j].order
		}
		return entries[i].name < entries[j].name
	})
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.name)
	}
	return names
}

// ChannelCaps is a channel's declared shape of difference. The registry and
// product frontends key ordering off DisplayOrder; CatalogBased/SupportsCancelURL
// document behavior the adapter absorbs (F1/F3): a channel that ignores
// CancelURL must say so here instead of silently dropping the parameter.
type ChannelCaps struct {
	CatalogBased      bool // 目录型（waffo/paypal 需预注册商品）vs 临时定价型（stripe price_data）
	SupportsCancelURL bool
	DisplayOrder      int      // /config billing_channels 排序；stripe 建议 200、manual 900、waffo 将来 100
	Currencies        []string // 空=不声明限制
}

// ChannelCapabilityViewer is the optional capability interface channels
// implement to declare their caps. Channels that don't implement it get
// DefaultChannelDisplayOrder in OrderedNames.
type ChannelCapabilityViewer interface {
	Capabilities() ChannelCaps
}

type Repo interface {
	CreateOrder(ctx context.Context, o domain.Order) (domain.Order, error)
	GetOrder(ctx context.Context, id string) (domain.Order, bool, error)
	ListOrdersByWorkspace(ctx context.Context, workspaceID string, limit int) ([]domain.Order, error)

	UpdateOrderStatus(ctx context.Context, id string, from, to domain.OrderStatus, now time.Time) error

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

	LatestPaidOrderInterval(ctx context.Context, workspaceID string) (interval string, ok bool, err error)

	ExpireDueWorkspaces(ctx context.Context, now time.Time, limit int) ([]ExpiredWorkspace, error)

	ExpireStaleOrders(ctx context.Context, now time.Time, limit int) ([]ExpiredOrder, error)

	InsertOverageOrder(ctx context.Context, o domain.Order) (order domain.Order, created bool, err error)

	ListMeteredWorkspaces(ctx context.Context, limit int) ([]MeteredWorkspace, error)
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

// ExpiredOrder is one pending order swept to canceled because its checkout
// session expiry (order.expires_at) has passed (F15: channels like waffo
// expire sessions with zero callbacks).
type ExpiredOrder struct {
	ID          string
	WorkspaceID string
}

var ErrDuplicate = errors.New("duplicate")

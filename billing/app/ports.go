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

type PaymentChannel interface {
	Name() string

	CreateCheckout(ctx context.Context, order domain.Order, successURL, cancelURL string) (domain.CheckoutSession, error)

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

func (r *ChannelRegistry) Names() []string {
	names := make([]string, 0, len(r.channels))
	for name := range r.channels {
		names = append(names, name)
	}
	return names
}

type Repo interface {
	CreateOrder(ctx context.Context, o domain.Order) (domain.Order, error)
	GetOrder(ctx context.Context, id string) (domain.Order, bool, error)
	ListOrdersByWorkspace(ctx context.Context, workspaceID string, limit int) ([]domain.Order, error)

	UpdateOrderStatus(ctx context.Context, id string, from, to domain.OrderStatus, now time.Time) error

	FailOrder(ctx context.Context, o domain.Order, e domain.PaymentEvent, emit func(tx pgx.Tx) error, now time.Time) error

	PayOrder(ctx context.Context, id string, emit func(tx pgx.Tx) error, now time.Time) error
	SetOrderChannelRef(ctx context.Context, id, channelRef string) error
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

var ErrDuplicate = errors.New("duplicate")

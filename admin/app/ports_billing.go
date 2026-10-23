package app

import (
	"context"
	"time"

	"github.com/haozing/ploykit/platform/webx"
)

type AdminOrder struct {
	ID            string     `json:"id"`
	WorkspaceID   string     `json:"workspace_id"`
	WorkspaceName string     `json:"workspace_name"`
	UserID        string     `json:"user_id"`
	PlanCode      string     `json:"plan_code"`
	Interval      string     `json:"interval"`
	AmountCents   int        `json:"amount_cents"`
	Currency      string     `json:"currency"`
	Channel       string     `json:"channel"`
	Status        string     `json:"status"`
	ChannelRef    string     `json:"channel_ref,omitempty"`
	PaidAt        *time.Time `json:"paid_at,omitempty"`
	CanceledAt    *time.Time `json:"canceled_at,omitempty"`
	RefundedAt    *time.Time `json:"refunded_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

type AdminPaymentEvent struct {
	ID             string     `json:"id"`
	Channel        string     `json:"channel"`
	ChannelEventID string     `json:"channel_event_id"`
	EventType      string     `json:"event_type"`
	OrderID        string     `json:"order_id,omitempty"`
	ProcessStatus  string     `json:"process_status"`
	ProcessError   string     `json:"process_error,omitempty"`
	ProcessedAt    *time.Time `json:"processed_at,omitempty"`
	Processed      bool       `json:"processed"`
	CreatedAt      time.Time  `json:"created_at"`
}

type AdminWebhookDelivery struct {
	ID             string     `json:"id"`
	WorkspaceID    string     `json:"workspace_id"`
	URL            string     `json:"url"`
	SubscriptionID string     `json:"subscription_id"`
	EventID        string     `json:"event_id"`
	EventType      string     `json:"event_type"`
	Status         string     `json:"status"`
	Attempts       int        `json:"attempts"`
	LastStatusCode int        `json:"last_status_code,omitempty"`
	LastError      string     `json:"last_error,omitempty"`
	DeliveredAt    *time.Time `json:"delivered_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

type AdminBillingChannel struct {
	Name              string `json:"name"`
	Configured        bool   `json:"configured"`
	KeyMasked         string `json:"key_masked"`
	WebhookConfigured bool   `json:"webhook_configured"`
}

type AdminPlanView struct {
	Code      string         `json:"code"`
	Name      string         `json:"name"`
	Currency  string         `json:"currency"`
	TrialDays int            `json:"trial_days"`
	SortNo    int            `json:"sort_no"`
	Limits    map[string]int `json:"limits"`
}

type AdminBillingConfig struct {
	Channels []AdminBillingChannel `json:"channels"`
}

// ---- BC-5/BC-6/BC-7 admin billing-channels surface ----

type AdminFieldOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type AdminFieldSpec struct {
	Key      string             `json:"key"`
	Label    string             `json:"label"`
	Type     string             `json:"type"`
	Required bool               `json:"required"`
	Help     string             `json:"help"`
	Options  []AdminFieldOption `json:"options"`
}

type AdminChannelCaps struct {
	CatalogBased      bool     `json:"catalog_based"`
	SupportsCancelURL bool     `json:"supports_cancel_url"`
	DisplayOrder      int      `json:"display_order"`
	Currencies        []string `json:"currencies"`
}

type AdminChannelCard struct {
	Name              string                 `json:"name"`
	Configured        bool                   `json:"configured"`
	KeyMasked         string                 `json:"key_masked"`
	WebhookConfigured bool                   `json:"webhook_configured"`
	Capabilities      AdminChannelCaps       `json:"capabilities"`
	Schema            []AdminFieldSpec       `json:"schema"`
	Values            map[string]string      `json:"values"`
	ConfigSource      string                 `json:"config_source"`
}

type AdminChannelCatalogRow struct {
	Channel          string     `json:"channel"`
	PlanCode         string     `json:"plan_code"`
	Interval         string     `json:"interval"`
	ChannelProductID string     `json:"channel_product_id"`
	SyncedPriceCents int        `json:"synced_price_cents"`
	PlanPriceCents   int        `json:"plan_price_cents"`
	SyncedAt         *time.Time `json:"synced_at"`
}

type AdminChannelCatalogPlan struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	Currency     string `json:"currency"`
	MonthlyCents int    `json:"monthly_cents"`
	YearlyCents  int    `json:"yearly_cents"`
}

type AdminChannelCatalog struct {
	Rows  []AdminChannelCatalogRow  `json:"rows"`
	Plans []AdminChannelCatalogPlan `json:"plans"`
}

// AdminPlanUpdateInput is the full-replace payload for AdminUpdatePlan; the
// plan code rides in the request path and is never editable.
type AdminPlanUpdateInput struct {
	Name     string         `json:"name"`
	Currency string         `json:"currency"`
	SortNo   int            `json:"sort_no"`
	Limits   map[string]int `json:"limits"`
}

type BillingAdminOps interface {
	ListAllOrders(ctx context.Context, workspaceID, status string, limit, offset int) ([]AdminOrder, int, error)

	ListPaymentEvents(ctx context.Context, workspaceID string, limit, offset int) ([]AdminPaymentEvent, int, error)

	AdminCancelPendingOrder(ctx context.Context, actor *webx.Principal, orderID string) error

	RunExpiryNow(ctx context.Context) (int, error)

	RunOverageNow(ctx context.Context) (int, error)

	ListPlanCodes(ctx context.Context) ([]string, error)

	ListPlanViews(ctx context.Context) ([]AdminPlanView, error)

	AdminUpdatePlan(ctx context.Context, actor *webx.Principal, code string, input AdminPlanUpdateInput) (AdminPlanView, error)

	MarkOrderPaid(ctx context.Context, actor *webx.Principal, orderID string) error

	BillingConfig(ctx context.Context) (AdminBillingConfig, error)

	TestChannelConnection(ctx context.Context, channel string) error

	AdminCancelSubscription(ctx context.Context, actor *webx.Principal, workspaceID string) error

	// BC-5/BC-6/BC-7: channel credential cards, field save, catalog mapping.
	ChannelCards(ctx context.Context) ([]AdminChannelCard, error)
	UpdateChannelFields(ctx context.Context, actor *webx.Principal, channel string, fields map[string]string) (AdminChannelCard, error)
	ChannelCatalog(ctx context.Context) (AdminChannelCatalog, error)
	RegisterChannelProduct(ctx context.Context, actor *webx.Principal, channel, planCode, interval string) (string, error)
	SyncChannelPrice(ctx context.Context, actor *webx.Principal, channel, planCode, interval string) (int, error)
}

type WebhookAdminOps interface {
	ListAllDeliveries(ctx context.Context, workspaceID, status string, limit, offset int) ([]AdminWebhookDelivery, int, error)

	AdminRedeliver(ctx context.Context, deliveryID string) (AdminWebhookDelivery, error)
}

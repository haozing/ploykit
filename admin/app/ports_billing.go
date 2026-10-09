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

type BillingAdminOps interface {
	ListAllOrders(ctx context.Context, workspaceID, status string, limit, offset int) ([]AdminOrder, int, error)

	ListPaymentEvents(ctx context.Context, workspaceID string, limit, offset int) ([]AdminPaymentEvent, int, error)

	AdminCancelPendingOrder(ctx context.Context, actor *webx.Principal, orderID string) error

	RunExpiryNow(ctx context.Context) (int, error)

	RunOverageNow(ctx context.Context) (int, error)

	ListPlanCodes(ctx context.Context) ([]string, error)

	ListPlanViews(ctx context.Context) ([]AdminPlanView, error)

	MarkOrderPaid(ctx context.Context, actor *webx.Principal, orderID string) error

	BillingConfig(ctx context.Context) (AdminBillingConfig, error)

	TestChannelConnection(ctx context.Context, channel string) error

	AdminCancelSubscription(ctx context.Context, actor *webx.Principal, workspaceID string) error
}

type WebhookAdminOps interface {
	ListAllDeliveries(ctx context.Context, workspaceID, status string, limit, offset int) ([]AdminWebhookDelivery, int, error)

	AdminRedeliver(ctx context.Context, deliveryID string) (AdminWebhookDelivery, error)
}

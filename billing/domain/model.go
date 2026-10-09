package domain

import (
	"errors"
	"time"
)

type Plan struct {
	Code   string         `json:"code"`
	Name   string         `json:"name"`
	Limits map[string]int `json:"limits"`
	SortNo int            `json:"sort_no"`

	Currency string `json:"currency,omitempty"`
}

type BillingInterval string

const (
	IntervalMonthly BillingInterval = "monthly"
	IntervalYearly  BillingInterval = "yearly"
	IntervalOneTime BillingInterval = "one_time"
)

type OrderStatus string

const (
	OrderPending  OrderStatus = "pending"
	OrderPaid     OrderStatus = "paid"
	OrderFailed   OrderStatus = "failed"
	OrderCanceled OrderStatus = "canceled"
	OrderRefunded OrderStatus = "refunded"
)

type Order struct {
	ID          string          `json:"id"`
	WorkspaceID string          `json:"workspace_id"`
	UserID      string          `json:"user_id"`
	PlanCode    string          `json:"plan_code"`
	Interval    BillingInterval `json:"interval"`
	AmountCents int             `json:"amount_cents"`
	Currency    string          `json:"currency"`
	Channel     string          `json:"channel"`
	Status      OrderStatus     `json:"status"`
	ChannelRef  string          `json:"channel_ref,omitempty"`
	PaidAt      *time.Time      `json:"paid_at,omitempty"`
	CanceledAt  *time.Time      `json:"canceled_at,omitempty"`
	RefundedAt  *time.Time      `json:"refunded_at,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`

	TrialDays int `json:"trial_days,omitempty"`

	Metadata map[string]any `json:"metadata,omitempty"`
}

type CheckoutSession struct {
	OrderID    string    `json:"order_id"`
	Channel    string    `json:"channel"`
	ActionURL  string    `json:"action_url"`
	SessionRef string    `json:"session_ref"`
	ExpiresAt  time.Time `json:"expires_at"`
}

type PaymentEvent struct {
	Channel         string `json:"channel"`
	ChannelEventID  string `json:"channel_event_id"`
	Type            string `json:"type"`
	OrderID         string `json:"order_id,omitempty"`
	ChannelRef      string `json:"channel_ref,omitempty"`
	SubscriptionRef string `json:"subscription_ref,omitempty"`

	PaymentIntentRef string         `json:"payment_intent_ref,omitempty"`
	AmountCents      int            `json:"amount_cents,omitempty"`
	Currency         string         `json:"currency,omitempty"`
	Payload          map[string]any `json:"payload,omitempty"`
}

const (
	EventCheckoutCompleted    = "checkout.completed"
	EventPaymentFailed        = "payment.failed"
	EventRefundCreated        = "refund.created"
	EventSubscriptionRenewed  = "subscription.renewed"
	EventSubscriptionCanceled = "subscription.canceled"
)

func IntervalMonths(i BillingInterval) int {
	switch i {
	case IntervalYearly:
		return 12
	default:
		return 1
	}
}

var ErrStatusConflict = errors.New("order status conflict")

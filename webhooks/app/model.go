package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/haozing/ploykit/platform/whsign"
)

type Subscription struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace_id"`
	EventTypes  []string  `json:"event_types"`
	URL         string    `json:"url"`
	Description string    `json:"description"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
}

type Delivery struct {
	ID             string     `json:"id"`
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

const (
	StatusPending   = "pending"
	StatusDelivered = "delivered"
	StatusDead      = "dead"
)

var ErrNotFound = errors.New("webhooks: not found")

type OutboundEvent struct {
	ID      string
	Type    string
	Payload map[string]any
}

var RetryBackoff = []time.Duration{
	1 * time.Minute,
	5 * time.Minute,
	30 * time.Minute,
	2 * time.Hour,
	6 * time.Hour,
}

const (
	AbortHeader = "Webhook-Delivery"

	AbortHeaderValue = "abort-message"
)

// OldSecretTTL mirrors whsign.OldSecretTTL — the rotation window during which
// deliveries carry X-Signature-Old alongside X-Signature.
const OldSecretTTL = whsign.OldSecretTTL

const AutoDisableWindow = 5 * 24 * time.Hour

type EventCatalog struct {
	types map[string]string
}

func NewEventCatalog() *EventCatalog {
	return &EventCatalog{types: make(map[string]string)}
}

func (c *EventCatalog) Register(eventType, description string) {
	c.types[eventType] = description
}

func (c *EventCatalog) List() map[string]string {
	out := make(map[string]string, len(c.types))
	for k, v := range c.types {
		out[k] = v
	}
	return out
}

func (c *EventCatalog) Has(eventType string) bool {
	_, ok := c.types[eventType]
	return ok
}

type Repo interface {
	CreateSubscription(ctx context.Context, sub Subscription, secret string) (Subscription, error)
	ListSubscriptions(ctx context.Context, workspaceID string) ([]Subscription, error)
	DeleteSubscription(ctx context.Context, workspaceID, id string) error

	GetSubscription(ctx context.Context, workspaceID, id string) (Subscription, bool, error)

	SetSubscriptionActive(ctx context.Context, workspaceID, id string, active bool, now time.Time) error

	RotateSecret(ctx context.Context, workspaceID, subscriptionID, newSealed string, oldExpiresAt, now time.Time) error

	FirstFailureAt(ctx context.Context, subscriptionID string) (*time.Time, error)

	EmitForEvent(ctx context.Context, workspaceID string, event OutboundEvent) (int, error)

	ClaimPending(ctx context.Context, batchSize int) ([]PendingDelivery, error)

	MarkDelivered(ctx context.Context, deliveryID string, statusCode int, now time.Time) error

	MarkRetry(ctx context.Context, deliveryID string, statusCode int, errMsg string, nextAt time.Time, dead bool) error
	ListDeliveries(ctx context.Context, workspaceID string, limit int) ([]Delivery, error)

	Redeliver(ctx context.Context, workspaceID, deliveryID string) (Delivery, error)

	EnqueuePing(ctx context.Context, workspaceID, subscriptionID string) error
}

type PendingDelivery struct {
	DeliveryID     string
	SubscriptionID string

	WorkspaceID string
	URL         string

	Secret    string
	EventID   string
	EventType string
	Payload   json.RawMessage
	Attempts  int

	OldSealed    string
	OldExpiresAt *time.Time
	OldPlain     string
}

type Clock func() time.Time

func MintSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "whk_" + hex.EncodeToString(b), nil
}

// The signing protocol lives in platform/whsign (a stdlib-only leaf so
// webhook RECEIVERS can import it without pulling the webhooks domain); these
// aliases keep the historical export surface of this package compiling.
func Sign(secret string, timestamp time.Time, body []byte) string {
	return whsign.Sign(secret, timestamp, body)
}

func VerifySign(secret string, timestamp time.Time, body []byte, signature string) bool {
	return whsign.VerifySign(secret, timestamp, body, signature)
}

func VerifySignWithWindow(secret string, ts time.Time, body []byte, signature string, maxAge time.Duration, now time.Time) bool {
	return whsign.VerifySignWithWindow(secret, ts, body, signature, maxAge, now)
}

func VerifySignAny(secrets []string, timestamp time.Time, body []byte, signature string) bool {
	return whsign.VerifySignAny(secrets, timestamp, body, signature)
}

package app

import (
	"context"
	"time"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

const ChannelManual = "manual"

const manualCheckoutWindow = 7 * 24 * time.Hour

type ManualChannel struct {
	InfoURL string
}

var _ PaymentChannel = (*ManualChannel)(nil)

func (m *ManualChannel) Name() string { return ChannelManual }

func (m *ManualChannel) CreateCheckout(_ context.Context, req CheckoutRequest) (domain.CheckoutSession, error) {
	order := req.Order
	return domain.CheckoutSession{
		OrderID:    order.ID,
		Channel:    ChannelManual,
		ActionURL:  m.InfoURL,
		SessionRef: ChannelManual + ":" + order.ID,
		ExpiresAt:  time.Now().UTC().Add(manualCheckoutWindow),
	}, nil
}

// Capabilities declares manual's shape: no hosted cashier, so there is no
// cancel URL to return to (SupportsCancelURL=false — SuccessURL/CancelURL are
// ignored by design, declared here rather than silently dropped).
func (m *ManualChannel) Capabilities() ChannelCaps {
	return ChannelCaps{CatalogBased: false, SupportsCancelURL: false, DisplayOrder: 900}
}

func (m *ManualChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, webx.NewValidation("manual channel does not accept webhooks")
}

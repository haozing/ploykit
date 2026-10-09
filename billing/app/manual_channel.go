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

func (m *ManualChannel) CreateCheckout(_ context.Context, order domain.Order, _, _ string) (domain.CheckoutSession, error) {
	return domain.CheckoutSession{
		OrderID:    order.ID,
		Channel:    ChannelManual,
		ActionURL:  m.InfoURL,
		SessionRef: ChannelManual + ":" + order.ID,
		ExpiresAt:  time.Now().UTC().Add(manualCheckoutWindow),
	}, nil
}

func (m *ManualChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, webx.NewValidation("manual channel does not accept webhooks")
}

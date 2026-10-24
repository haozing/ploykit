package app

import (
	"context"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

const ChannelManual = "manual"

type ManualChannel struct {
	InfoURL string
}

var _ PaymentChannel = (*ManualChannel)(nil)

func (m *ManualChannel) Name() string { return ChannelManual }

// CreateCheckout returns a zero ExpiresAt (billing fix #2): manual is an
// offline-transfer channel with no hosted session to expire — the old 7-day
// window let the abandoned-checkout sweeper flip a still-reconcilable
// transfer order to canceled while the buyer's bank transfer was in flight.
// A zero ExpiresAt persists as NULL (SetOrderChannelRefAndExpiry) and the
// order never participates in the sweep; offline verification stays manual
// (MarkOrderPaid) with no deadline.
func (m *ManualChannel) CreateCheckout(_ context.Context, req CheckoutRequest) (domain.CheckoutSession, error) {
	order := req.Order
	return domain.CheckoutSession{
		OrderID:    order.ID,
		Channel:    ChannelManual,
		ActionURL:  m.InfoURL,
		SessionRef: ChannelManual + ":" + order.ID,
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

// ConfigSchema implements ChannelSchemaViewer (BC-6): the admin channel card
// renders its form from this descriptor; info_url is the payment-instruction
// page buyers land on instead of a hosted cashier.
func (m *ManualChannel) ConfigSchema() []FieldSpec {
	return []FieldSpec{
		{Key: "info_url", Label: "转账说明页", Type: FieldTypeText,
			Help: "买家点击支付跳转的说明页 URL(收款方式/备注/人工核销流程);空 = 仅展示订单。线下转账无会话过期：订单不设到期时间，也不参与弃单清扫，核销无截止"},
	}
}

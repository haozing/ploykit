package stripe

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
	stripeapi "github.com/stripe/stripe-go/v87"
	stripeclient "github.com/stripe/stripe-go/v87/client"
	stripewebhook "github.com/stripe/stripe-go/v87/webhook"
)

type Channel struct {
	SecretKey         string
	WebhookSigningKey string

	backends *stripeapi.Backends
	api      *stripeclient.API
}

func New(secretKey, webhookSigningKey string) *Channel {
	c := &Channel{SecretKey: secretKey, WebhookSigningKey: webhookSigningKey}
	c.initAPI()
	return c
}

func (c *Channel) initAPI() {
	sc := &stripeclient.API{}
	sc.Init(c.SecretKey, c.backends)
	c.api = sc
}

func (c *Channel) setBackends(b *stripeapi.Backends) {
	c.backends = b
	c.initAPI()
}

func (c *Channel) Name() string { return "stripe" }

func (c *Channel) CreateCheckout(ctx context.Context, req app.CheckoutRequest) (domain.CheckoutSession, error) {
	order := req.Order
	params := &stripeapi.CheckoutSessionParams{
		Params: stripeapi.Params{Context: ctx},
		Mode:   stripeapi.String(string(stripeapi.CheckoutSessionModePayment)),
		LineItems: []*stripeapi.CheckoutSessionLineItemParams{{
			Quantity: stripeapi.Int64(1),
			PriceData: &stripeapi.CheckoutSessionLineItemPriceDataParams{

				Currency:   stripeapi.String(strings.ToLower(order.Currency)),
				UnitAmount: stripeapi.Int64(int64(order.AmountCents)),
				ProductData: &stripeapi.CheckoutSessionLineItemPriceDataProductDataParams{
					Name: stripeapi.String(order.PlanCode + " (" + string(order.Interval) + ")"),
				},
			},
		}},
		Metadata:   map[string]string{"order_id": order.ID},
		SuccessURL: stripeapi.String(req.SuccessURL),
		CancelURL:  stripeapi.String(req.CancelURL),
		ExpiresAt:  stripeapi.Int64(time.Now().Add(24 * time.Hour).Unix()),
	}

	if req.BuyerEmail != "" {
		params.CustomerEmail = stripeapi.String(req.BuyerEmail)
	}
	if req.Locale != "" {
		params.Locale = stripeapi.String(strings.ToLower(req.Locale))
	}

	if order.Interval == domain.IntervalOneTime {
		params.PaymentIntentData = &stripeapi.CheckoutSessionPaymentIntentDataParams{
			Metadata: map[string]string{"order_id": order.ID},
		}
	}

	if order.Interval != domain.IntervalOneTime {
		params.Mode = stripeapi.String(string(stripeapi.CheckoutSessionModeSubscription))
		params.LineItems[0].PriceData.Recurring = &stripeapi.CheckoutSessionLineItemPriceDataRecurringParams{
			Interval: stripeapi.String(stripeRecurringInterval(order.Interval)),
		}
		params.SubscriptionData = &stripeapi.CheckoutSessionSubscriptionDataParams{
			Metadata: map[string]string{"order_id": order.ID},
		}
		if order.TrialDays > 0 {
			params.SubscriptionData.TrialEnd = stripeapi.Int64(
				time.Now().Add(time.Duration(order.TrialDays) * 24 * time.Hour).Unix())
		}
	}
	s, err := c.api.CheckoutSessions.New(params)
	if err != nil {
		return domain.CheckoutSession{}, fmt.Errorf("stripe: create checkout session: %w", err)
	}
	return domain.CheckoutSession{
		OrderID:    order.ID,
		Channel:    c.Name(),
		ActionURL:  s.URL,
		SessionRef: s.ID,
		ExpiresAt:  time.Unix(s.ExpiresAt, 0).UTC(),
	}, nil
}

func (c *Channel) ParseWebhook(ctx context.Context, req app.WebhookRequest) (domain.PaymentEvent, error) {
	sig := http.Header(req.Header).Get("Stripe-Signature")
	if sig == "" {
		return domain.PaymentEvent{}, webx.NewValidation("missing Stripe-Signature header")
	}
	evt, err := stripewebhook.ConstructEvent(req.Body, sig, c.WebhookSigningKey)
	if err != nil {
		return domain.PaymentEvent{}, webx.NewValidation("stripe webhook verification failed: " + err.Error())
	}
	if evt.Data == nil {
		return domain.PaymentEvent{}, webx.NewValidation("stripe webhook event missing data")
	}

	ev := domain.PaymentEvent{
		Channel:        c.Name(),
		ChannelEventID: evt.ID,
		Payload:        evt.Data.Object,
	}
	switch evt.Type {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		var obj stripeapi.CheckoutSession
		if err := json.Unmarshal(evt.Data.Raw, &obj); err != nil {
			return domain.PaymentEvent{}, fmt.Errorf("stripe: decode checkout session: %w", err)
		}

		if obj.PaymentStatus != "" &&
			obj.PaymentStatus != stripeapi.CheckoutSessionPaymentStatusPaid &&
			obj.PaymentStatus != stripeapi.CheckoutSessionPaymentStatusNoPaymentRequired {
			ev.Type = "ignored"
			return ev, nil
		}
		ev.Type = domain.EventCheckoutCompleted
		ev.OrderID = obj.Metadata["order_id"]
		ev.ChannelRef = obj.ID
		ev.AmountCents = int(obj.AmountTotal)
		ev.Currency = string(obj.Currency)
		if obj.PaymentIntent != nil {

			ev.PaymentIntentRef = obj.PaymentIntent.ID
		}
		if obj.Subscription != nil {
			ev.SubscriptionRef = obj.Subscription.ID
		}
	case "checkout.session.async_payment_failed":
		var obj stripeapi.CheckoutSession
		if err := json.Unmarshal(evt.Data.Raw, &obj); err != nil {
			return domain.PaymentEvent{}, fmt.Errorf("stripe: decode checkout session: %w", err)
		}

		ev.Type = domain.EventPaymentFailed
		ev.OrderID = obj.Metadata["order_id"]
		ev.ChannelRef = obj.ID
		if obj.PaymentIntent != nil {
			ev.PaymentIntentRef = obj.PaymentIntent.ID
		}
	case "invoice.paid":
		var obj stripeapi.Invoice
		if err := json.Unmarshal(evt.Data.Raw, &obj); err != nil {
			return domain.PaymentEvent{}, fmt.Errorf("stripe: decode invoice: %w", err)
		}
		ev.Type = domain.EventSubscriptionRenewed
		ev.SubscriptionRef = invoiceSubscriptionID(evt.Data.Raw, &obj)
		ev.AmountCents = int(obj.AmountPaid)
		ev.Currency = string(obj.Currency)
		if obj.Lines != nil && len(obj.Lines.Data) > 0 {
			ev.OrderID = obj.Lines.Data[0].Metadata["order_id"]
		}
	case "customer.subscription.deleted":
		var obj stripeapi.Subscription
		if err := json.Unmarshal(evt.Data.Raw, &obj); err != nil {
			return domain.PaymentEvent{}, fmt.Errorf("stripe: decode subscription: %w", err)
		}
		ev.Type = domain.EventSubscriptionCanceled
		ev.SubscriptionRef = obj.ID
	case "payment_intent.payment_failed":
		var obj stripeapi.PaymentIntent
		if err := json.Unmarshal(evt.Data.Raw, &obj); err != nil {
			return domain.PaymentEvent{}, fmt.Errorf("stripe: decode payment intent: %w", err)
		}
		ev.Type = domain.EventPaymentFailed
		ev.OrderID = obj.Metadata["order_id"]
		ev.ChannelRef = obj.ID
		ev.PaymentIntentRef = obj.ID
	case "charge.refunded":
		var obj stripeapi.Charge
		if err := json.Unmarshal(evt.Data.Raw, &obj); err != nil {
			return domain.PaymentEvent{}, fmt.Errorf("stripe: decode charge: %w", err)
		}
		ev.Type = domain.EventRefundCreated

		if obj.PaymentIntent != nil {
			ev.ChannelRef = obj.PaymentIntent.ID
			ev.PaymentIntentRef = obj.PaymentIntent.ID
		}
		if len(obj.Currency) > 0 {
			ev.Currency = string(obj.Currency)
			ev.AmountCents = int(obj.AmountRefunded)
		}
	default:
		ev.Type = "ignored"
	}
	return ev, nil
}

func stripeRecurringInterval(i domain.BillingInterval) string {
	if i == domain.IntervalYearly {
		return "year"
	}
	return "month"
}

func (c *Channel) Capabilities() app.ChannelCaps {
	return app.ChannelCaps{CatalogBased: false, SupportsCancelURL: true, DisplayOrder: 200}
}

func (c *Channel) ChannelConfig() app.ChannelConfigInfo {
	return app.ChannelConfigInfo{
		Configured:        c.SecretKey != "",
		KeyMasked:         maskKey(c.SecretKey),
		WebhookConfigured: c.WebhookSigningKey != "",
	}
}

// ConfigSchema implements app.ChannelSchemaViewer (BC-6): the admin channel
// card renders its form from this descriptor. Field keys are the
// billing_channel.stripe.* settings keys.
func (c *Channel) ConfigSchema() []app.FieldSpec {
	return []app.FieldSpec{
		{Key: "secret_key", Label: "Secret key", Type: app.FieldTypeSecret, Required: true,
			Help: "sk_test_…/sk_live_…;测试/生产各一把,分环境各自保存"},
		{Key: "webhook_signing_key", Label: "Webhook 签名密钥", Type: app.FieldTypeSecret,
			Help: "Stripe Dashboard → Developers → Webhooks → Signing secret(whsec_…)"},
		{Key: "mode", Label: "环境模式", Type: app.FieldTypeSelect,
			Help: "与密钥前缀保持一致(sk_test_ = test);展示用徽标",
			Options: []app.FieldOption{
				{Value: "test", Label: "test(测试)"},
				{Value: "prod", Label: "prod(生产)"},
			}},
	}
}

func maskKey(k string) string {
	if k == "" {
		return ""
	}
	if len(k) <= 12 {
		return "***"
	}
	return k[:8] + "***" + k[len(k)-4:]
}

func (c *Channel) TestConnection(ctx context.Context) error {
	if c.SecretKey == "" {
		return errNotConfigured()
	}
	if _, err := c.api.Balance.Get(&stripeapi.BalanceParams{
		Params: stripeapi.Params{Context: ctx},
	}); err != nil {
		return fmt.Errorf("stripe: test connection: %w", err)
	}
	return nil
}

func (c *Channel) CancelCheckout(ctx context.Context, sessionRef string) error {
	if c.SecretKey == "" {
		return errNotConfigured()
	}
	if _, err := c.api.CheckoutSessions.Expire(sessionRef, &stripeapi.CheckoutSessionExpireParams{
		Params: stripeapi.Params{Context: ctx},
	}); err != nil {
		return fmt.Errorf("stripe: expire checkout session: %w", err)
	}
	return nil
}

func (c *Channel) CancelSubscription(ctx context.Context, providerSubID string) error {
	if c.SecretKey == "" {
		return errNotConfigured()
	}
	if _, err := c.api.Subscriptions.Cancel(providerSubID, &stripeapi.SubscriptionCancelParams{
		Params: stripeapi.Params{Context: ctx},
	}); err != nil {
		return fmt.Errorf("stripe: cancel subscription: %w", err)
	}
	return nil
}

func errNotConfigured() error {
	return webx.NewError(400, app.CodeChannelNotConfigured, "渠道未配置密钥")
}

func invoiceSubscriptionID(raw []byte, obj *stripeapi.Invoice) string {
	if obj.Parent != nil && obj.Parent.SubscriptionDetails != nil && obj.Parent.SubscriptionDetails.Subscription != nil {
		return obj.Parent.SubscriptionDetails.Subscription.ID
	}
	var legacy struct {
		Subscription string `json:"subscription"`
	}
	if json.Unmarshal(raw, &legacy) == nil {
		return legacy.Subscription
	}
	return ""
}

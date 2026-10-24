package app

import (
	"context"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

// DisabledChannel is the placeholder a channel factory returns when the
// channel is "unconfigured" (credentials entirely absent): it makes the
// channel VISIBLE on the admin billing-channels page (its schema renders the
// form an operator pastes credentials into, UpdateChannelFields accepts the
// save) while the ACTIVE channel set (OrderedNames → /config
// billing_channels, checkout, BillingConfig) does not include it.
//
// This breaks the chicken-and-egg loop of BC-5: a channel used to register
// only when its credentials were complete, but credentials could only be
// saved through a registered channel's card — env was the only way to
// bootstrap paypal/waffo/stripe. Factories now return
// NewDisabledChannel(name, Schema(), Caps()) instead of (nil, nil); once the
// saved fields make the real factory succeed, RefreshNow rebuilds the set and
// the stub is replaced by the live channel.
//
// Returning the stub (not nil) from a factory whose signature is
// (app.PaymentChannel, error) also kills the typed-nil trap at the root: a
// concrete `return nil, nil` from (*Channel, error) used to produce a non-nil
// interface holding a nil pointer — a ghost channel registered into /config.
type DisabledChannel struct {
	ChName string
	Schema []FieldSpec
	Caps   ChannelCaps
}

// NewDisabledChannel builds the stub. schema/caps should come from the
// adapter's static Schema()/Caps() (the same single source the live
// channel's instance methods delegate to), so the admin form and priority
// ordering match the real channel exactly.
func NewDisabledChannel(name string, schema []FieldSpec, caps ChannelCaps) *DisabledChannel {
	return &DisabledChannel{ChName: name, Schema: schema, Caps: caps}
}

func (d *DisabledChannel) Name() string { return d.ChName }

// Capabilities mirrors the real channel's declaration (ordering on the admin
// page, currency whitelist visibility) — the stub is the channel's card, not
// a different channel.
func (d *DisabledChannel) Capabilities() ChannelCaps { return d.Caps }

// ConfigSchema renders the admin form so credentials can be pasted — that is
// the stub's whole reason to exist.
func (d *DisabledChannel) ConfigSchema() []FieldSpec { return d.Schema }

// ChannelConfig reports the honest state: nothing configured, nothing
// masked, no webhook. OrderedNames/BillingConfig filter on this.
func (d *DisabledChannel) ChannelConfig() ChannelConfigInfo {
	return ChannelConfigInfo{Configured: false, KeyMasked: "", WebhookConfigured: false}
}

// CreateCheckout never succeeds on a stub — the channel is not in the active
// set, but if a stale client reaches here anyway (e.g. ordered /config list
// cached from before the swap), the error names the fix instead of a
// generic failure.
func (d *DisabledChannel) CreateCheckout(_ context.Context, _ CheckoutRequest) (domain.CheckoutSession, error) {
	return domain.CheckoutSession{}, webx.NewValidation(
		d.ChName + " channel not configured — save credentials in admin billing channels")
}

// ParseWebhook rejects before any signature work: a stub has no signing
// secret, so no signature could ever verify.
func (d *DisabledChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, webx.NewValidation(
		d.ChName + " channel not configured — webhook signing credentials missing; save them in admin billing channels")
}

// TestConnection / CancelSubscription / CancelCheckout answer with the same
// E_CHANNEL_NOT_CONFIGURED shape the real adapters use when their key is
// empty (see stripe.errNotConfigured), so the admin surface stays uniform.
// TestChannelConnection short-circuits on ChannelConfig().Configured=false
// before reaching these — they are defense for direct calls.

func (d *DisabledChannel) TestConnection(context.Context) error { return errChannelNotConfigured() }

func (d *DisabledChannel) CancelSubscription(_ context.Context, _ string) error {
	return errChannelNotConfigured()
}

func (d *DisabledChannel) CancelCheckout(_ context.Context, _ string) error {
	return errChannelNotConfigured()
}

// ChannelEnvViewer is deliberately NOT implemented: the env-fallback exemption
// ("clearing a required field is legal when env provides the key") needs live
// per-key env inspection the static stub does not have; without it the card
// simply shows no env_provided keys, which is accurate for a channel whose
// factory returned a stub (env was empty for every key — otherwise the real
// factory would have run).

// 编译期断言:满足 PaymentChannel 与三个 Viewer + 可选操作面。
var (
	_ PaymentChannel          = (*DisabledChannel)(nil)
	_ ChannelCapabilityViewer = (*DisabledChannel)(nil)
	_ ChannelSchemaViewer     = (*DisabledChannel)(nil)
	_ ChannelConfigViewer     = (*DisabledChannel)(nil)
	_ ConnectionTester        = (*DisabledChannel)(nil)
	_ SubscriptionCanceller   = (*DisabledChannel)(nil)
	_ CheckoutCanceller       = (*DisabledChannel)(nil)
)

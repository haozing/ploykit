package app

import (
	"context"

	"github.com/haozing/ploykit/platform/webx"
)

const (
	CodeChannelNotConfigured = "E_CHANNEL_NOT_CONFIGURED"

	CodeChannelTestUnsupported = "E_CHANNEL_TEST_UNSUPPORTED"

	CodeChannelCancelUnsupported = "E_CHANNEL_CANCEL_UNSUPPORTED"
)

type ConnectionTester interface {
	TestConnection(ctx context.Context) error
}

type SubscriptionCanceller interface {
	CancelSubscription(ctx context.Context, providerSubID string) error
}

type ChannelConfigInfo struct {
	Configured bool

	KeyMasked string

	WebhookConfigured bool
}

type ChannelConfigViewer interface {
	ChannelConfig() ChannelConfigInfo
}

type ChannelConfigView struct {
	Name string `json:"name"`

	Configured bool `json:"configured"`

	KeyMasked string `json:"key_masked"`

	WebhookConfigured bool `json:"webhook_configured"`
}

type BillingConfigView struct {
	Channels []ChannelConfigView `json:"channels"`
}

func errChannelNotConfigured() *webx.Error {
	return webx.NewError(400, CodeChannelNotConfigured, "渠道未配置密钥")
}

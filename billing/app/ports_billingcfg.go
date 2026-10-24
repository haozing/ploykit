package app

import (
	"context"

	"github.com/haozing/ploykit/platform/webx"
)

const (
	CodeChannelNotConfigured = "E_CHANNEL_NOT_CONFIGURED"

	CodeChannelTestUnsupported = "E_CHANNEL_TEST_UNSUPPORTED"

	CodeChannelCancelUnsupported = "E_CHANNEL_CANCEL_UNSUPPORTED"

	CodeChannelProductUnsupported = "E_CHANNEL_PRODUCT_UNSUPPORTED"
)

// FieldSpec is one credential/config field of a channel's ConfigSchema
// (BC-6): the admin form renders from this descriptor, so a fourth channel
// ships with zero UI changes. JSON tags are the API contract with the
// billing-channels frontend — do not rename.
type FieldSpec struct {
	Key      string        `json:"key"`
	Label    string        `json:"label"`
	Type     string        `json:"type"` // "text" | "secret" | "select"
	Required bool          `json:"required"`
	Help     string        `json:"help"`
	Options  []FieldOption `json:"options"` // select 字段的候选；nil 序列化为 null
}

// FieldOption is one candidate of a select-typed FieldSpec.
type FieldOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// Field type literals for FieldSpec.Type.
const (
	FieldTypeText   = "text"
	FieldTypeSecret = "secret"
	FieldTypeSelect = "select"
)

// ChannelSchemaViewer is the optional interface channels implement to
// describe their configuration surface. Channels without it cannot be edited
// from the admin billing page (env-only wiring).
type ChannelSchemaViewer interface {
	ConfigSchema() []FieldSpec
}

// ChannelSettingsStore is the settings-I/O port for channel credentials
// (BC-5); *settings.Store satisfies it structurally (billing must not import
// settings). Keys materialize as billing_channel.<name>.<field>, sealed at
// rest per settings.IsSensitive.
type ChannelSettingsStore interface {
	Set(ctx context.Context, key, value, actor string) error
	// SetMany writes multiple keys in ONE transaction (billing fix #11): a
	// channel save is all-or-nothing — a mid-save failure used to leave the
	// hot-reload registry reading a half-saved channel. An empty map is a no-op.
	SetMany(ctx context.Context, kv map[string]string, actor string) error
	// BillingChannelFields returns all billing_channel.* rows unsealed,
	// grouped by channel name (absent = no DB config for that channel). A row
	// that fails to unseal is skipped (that channel stays unconfigured) — it
	// must not error the whole read (fix #5: one poisoned row used to take
	// every channel down).
	BillingChannelFields(ctx context.Context) (map[string]map[string]string, error)
}

// ChannelRefresher forces a channel-set rebuild out of band; *AtomicRegistry
// implements it. The admin PUT path calls it after saving so the response
// card reflects the new effective state without waiting for the poll.
type ChannelRefresher interface {
	RefreshNow(ctx context.Context) error
}

// ChannelSettingsPrefix materializes channel field keys:
// billing_channel.<channel>.<field> (keep in sync with settings.BillingChannelKeyPrefix).
const ChannelSettingsPrefix = "billing_channel."

// ChannelSettingsKey builds one settings key for a channel field.
func ChannelSettingsKey(channel, field string) string {
	return ChannelSettingsPrefix + channel + "." + field
}

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

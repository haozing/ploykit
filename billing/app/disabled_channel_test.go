package app

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func newTestStub() *DisabledChannel {
	return NewDisabledChannel("paypal", []FieldSpec{
		{Key: "client_id", Label: "Client ID", Type: FieldTypeText, Required: true},
		{Key: "client_secret", Label: "Client Secret", Type: FieldTypeSecret, Required: true},
	}, ChannelCaps{CatalogBased: true, SupportsCancelURL: true, DisplayOrder: 300,
		Currencies: []string{"USD"}})
}

// 接口面:桩满足 PaymentChannel + 三个 Viewer + 操作面(编译断言在
// disabled_channel.go),这里断言行为语义。
func TestDisabledChannel_Faces(t *testing.T) {
	stub := newTestStub()

	assert.Equal(t, "paypal", stub.Name())
	assert.Equal(t, 300, stub.Capabilities().DisplayOrder)
	assert.True(t, stub.Capabilities().CatalogBased)
	require.Len(t, stub.ConfigSchema(), 2)
	assert.Equal(t, "client_id", stub.ConfigSchema()[0].Key)

	// ChannelConfig 是全桩核心:未配置状态让 OrderedNames/BillingConfig 过滤。
	cc := stub.ChannelConfig()
	assert.False(t, cc.Configured)
	assert.Empty(t, cc.KeyMasked)
	assert.False(t, cc.WebhookConfigured)

	// 不实现 ChannelEnvViewer:清空回退 env 豁免对桩不可用(静态桩无从知道
	// env 键在供),断言它确实不满足该接口。
	_, isEnvViewer := any(stub).(ChannelEnvViewer)
	assert.False(t, isEnvViewer, "DisabledChannel must not implement ChannelEnvViewer")
}

func TestDisabledChannel_RejectsOperations(t *testing.T) {
	stub := newTestStub()
	ctx := context.Background()

	_, err := stub.CreateCheckout(ctx, CheckoutRequest{})
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, http.StatusBadRequest, we.Status)
	assert.Contains(t, we.Message, "paypal")
	assert.Contains(t, we.Message, "not configured")

	_, err = stub.ParseWebhook(ctx, WebhookRequest{})
	require.ErrorAs(t, err, &we)
	assert.Equal(t, http.StatusBadRequest, we.Status)
	assert.Contains(t, we.Message, "not configured")

	// 三个可选操作面同款 E_CHANNEL_NOT_CONFIGURED(与 stripe 适配器
	// errNotConfigured 同型)。
	for name, call := range map[string]func() error{
		"TestConnection":     func() error { return stub.TestConnection(ctx) },
		"CancelSubscription": func() error { return stub.CancelSubscription(ctx, "SUB_1") },
		"CancelCheckout":     func() error { return stub.CancelCheckout(ctx, "cs_1") },
	} {
		require.ErrorAs(t, call(), &we, "%s must fail", name)
		assert.Equal(t, http.StatusBadRequest, we.Status, name)
		assert.Equal(t, CodeChannelNotConfigured, we.Code, name)
	}
}

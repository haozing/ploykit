package bridge

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	webhooksapp "github.com/haozing/ploykit/webhooks/app"
)

func TestMapDelivery_Fidelity(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	dl := time.Date(2026, 10, 8, 12, 5, 0, 0, time.UTC)
	in := webhooksapp.AdminDeliveryView{
		Delivery: webhooksapp.Delivery{
			ID: "dlv-1", SubscriptionID: "sub-1", EventID: "evt-1",
			EventType: "task.created", Status: "pending", Attempts: 3,
			LastStatusCode: 500, LastError: "HTTP 500",
			DeliveredAt: &dl, CreatedAt: now,
		},
		WorkspaceID: "ws-1", URL: "https://e.example.com/hook",
	}
	got := mapDelivery(in)
	assert.Equal(t, "dlv-1", got.ID)
	assert.Equal(t, "ws-1", got.WorkspaceID)
	assert.Equal(t, "https://e.example.com/hook", got.URL)
	assert.Equal(t, "sub-1", got.SubscriptionID)
	assert.Equal(t, "evt-1", got.EventID)
	assert.Equal(t, "task.created", got.EventType)
	assert.Equal(t, "pending", got.Status)
	assert.Equal(t, 3, got.Attempts)
	assert.Equal(t, 500, got.LastStatusCode)
	assert.Equal(t, "HTTP 500", got.LastError)
	assert.NotNil(t, got.DeliveredAt, "DeliveredAt 指针语义保留（nil = 未送达）")
	assert.True(t, got.DeliveredAt.Equal(dl))
	assert.True(t, got.CreatedAt.Equal(now))

	in.DeliveredAt = nil
	assert.Nil(t, mapDelivery(in).DeliveredAt)
}

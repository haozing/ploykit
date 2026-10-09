package pgrepo

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
)

func seedEvent(t *testing.T, repo *Repo) domain.PaymentEvent {
	t.Helper()
	e := domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_bq_" + uuid.NewString()[:12], Type: domain.EventCheckoutCompleted,
	}
	isNew, err := repo.InsertPaymentEvent(context.Background(), e)
	require.NoError(t, err)
	require.True(t, isNew)
	t.Cleanup(func() {
		_, _ = repo.pool.Exec(context.Background(),
			`DELETE FROM payment_event WHERE channel = $1 AND channel_event_id = $2`, e.Channel, e.ChannelEventID)
	})
	return e
}

func TestMarkEventError_Persists_BQ1(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()
	e := seedEvent(t, repo)

	require.NoError(t, repo.MarkEventError(ctx, e.Channel, e.ChannelEventID, "update order status: db down"))

	var status, processErr string
	var processedAt *any
	require.NoError(t, repo.pool.QueryRow(ctx,
		`SELECT process_status, process_error, processed_at FROM payment_event
		 WHERE channel = $1 AND channel_event_id = $2`, e.Channel, e.ChannelEventID).
		Scan(&status, &processErr, &processedAt))
	assert.Equal(t, "error", status)
	assert.Equal(t, "update order status: db down", processErr)
	assert.Nil(t, processedAt, "error 态不应残留 processed_at")
}

func TestInsertPaymentEvent_RevivesErrorState_BQ1(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()
	e := seedEvent(t, repo)

	require.NoError(t, repo.MarkEventProcessed(ctx, e.Channel, e.ChannelEventID))
	isNew, err := repo.InsertPaymentEvent(ctx, e)
	require.NoError(t, err)
	assert.False(t, isNew, "processed 态重复投递应 duplicate ignored")

	require.NoError(t, repo.MarkEventError(ctx, e.Channel, e.ChannelEventID, "boom"))
	isNew, err = repo.InsertPaymentEvent(ctx, e)
	require.NoError(t, err)
	assert.True(t, isNew, "error 态重试必须复活（否则支付事件永久丢失——BQ1 时序）")

	var status string
	var processErr *string
	require.NoError(t, repo.pool.QueryRow(ctx,
		`SELECT process_status, process_error FROM payment_event
		 WHERE channel = $1 AND channel_event_id = $2`, e.Channel, e.ChannelEventID).Scan(&status, &processErr))
	assert.Equal(t, "received", status)
	assert.Nil(t, processErr, "复活时清错误载荷")

	isNew, err = repo.InsertPaymentEvent(ctx, e)
	require.NoError(t, err)
	assert.False(t, isNew, "received 态（并发处理中）不应复活，防双分发")
}

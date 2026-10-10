package pgrepo

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/events"
	"github.com/haozing/ploykit/platform/pgmigrate"
)

func newBillingScratchPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	admin, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	scratch := "billing_it_" + uuid.NewString()[:8]
	_, err = admin.Exec(ctx, "CREATE DATABASE "+scratch)
	require.NoError(t, err, "scratch db（dev compose 用户 pk 是 superuser）")

	u, err := url.Parse(dsn)
	require.NoError(t, err)
	u.Path = "/" + scratch
	pool, err := pgxpool.New(ctx, u.String())
	require.NoError(t, err)

	require.NoError(t, pgmigrate.Up(ctx, pool, migrations.FS, "."))
	migrator, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	require.NoError(t, err)
	_, err = migrator.Migrate(ctx, rivermigrate.DirectionUp, nil)
	require.NoError(t, err)

	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer dropCancel()
		_, _ = admin.Exec(dropCtx, fmt.Sprintf("DROP DATABASE %s WITH (FORCE)", scratch))
		admin.Close()
	})
	return pool
}

type stubChannel struct{ event domain.PaymentEvent }

func (c *stubChannel) Name() string { return "stripe" }
func (c *stubChannel) CreateCheckout(_ context.Context, _ domain.Order, _, _ string) (domain.CheckoutSession, error) {
	return domain.CheckoutSession{}, nil
}
func (c *stubChannel) ParseWebhook(_ context.Context, _ app.WebhookRequest) (domain.PaymentEvent, error) {
	return c.event, nil
}

func adaptEmitter(em *events.Emitter) func(context.Context, pgx.Tx, events.Event) error {
	return func(ctx context.Context, tx pgx.Tx, ev events.Event) error {
		return em.Emit(ctx, tx, ev)
	}
}

func TestHandleWebhook_PaymentFailed_EmitsEventDB(t *testing.T) {
	pool := newBillingScratchPool(t)
	ctx := context.Background()
	repo := New(pool)

	uid, ws := uuid.NewString(), uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`, uid, uid[:8]+"@pf.test")
	require.NoError(t, err)
	_, err = pool.Exec(ctx,
		`INSERT INTO workspace (id, slug, name, plan_code, created_by) VALUES ($1, $2, 'pf', 'free', $3)`,
		ws, "pf-"+ws[:12], uid)
	require.NoError(t, err)
	orderID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO "order" (id, workspace_id, user_id, plan_code, interval, amount_cents, currency, channel, status)
		VALUES ($1, $2, $3, 'free', 'monthly', 9900, 'CNY', 'stripe', 'pending')`,
		orderID, ws, uid)
	require.NoError(t, err)

	emitter, err := events.New(pool, nil)
	require.NoError(t, err)
	reg := app.NewChannelRegistry()
	reg.Register(&stubChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_pf_db", Type: domain.EventPaymentFailed, OrderID: orderID,
	}})
	svc := app.NewBillingService(repo, reg, app.Config{Currency: "CNY"}, app.BillingHooks{}, nil,
		func() time.Time { return time.Now().UTC() }, nil).
		WithEventEmitter(adaptEmitter(emitter))

	require.NoError(t, svc.HandleWebhook(ctx, "stripe", app.WebhookRequest{}))

	var status string
	require.NoError(t, pool.QueryRow(ctx, `SELECT status FROM "order" WHERE id = $1`, orderID).Scan(&status))
	assert.Equal(t, "failed", status)
	var proc string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT process_status FROM payment_event WHERE channel='stripe' AND channel_event_id='evt_pf_db'`).Scan(&proc))
	assert.Equal(t, "processed", proc)

	var kind, idem, argsWs string
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT args->>'kind', args->>'idempotency_key', args->>'workspace_id'
		FROM river_job WHERE kind = 'ploykit.event'`).Scan(&kind, &idem, &argsWs))
	assert.Equal(t, app.KindPaymentFailed, kind)
	assert.Equal(t, "billing.payment_failed:"+orderID, idem)
	assert.Equal(t, ws, argsWs)
}

func TestMarkOrderPaid_EmitsEventDB(t *testing.T) {
	pool := newBillingScratchPool(t)
	ctx := context.Background()
	repo := New(pool)

	uid, ws := uuid.NewString(), uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`, uid, uid[:8]+"@mp.test")
	require.NoError(t, err)
	_, err = pool.Exec(ctx,
		`INSERT INTO workspace (id, slug, name, plan_code, created_by) VALUES ($1, $2, 'mp', 'pro', $3)`,
		ws, "mp-"+ws[:12], uid)
	require.NoError(t, err)
	orderID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO "order" (id, workspace_id, user_id, plan_code, interval, amount_cents, currency, channel, status)
		VALUES ($1, $2, $3, 'pro', 'one_time', 4200, 'CNY', 'manual', 'pending')`,
		orderID, ws, uid)
	require.NoError(t, err)

	emitter, err := events.New(pool, nil)
	require.NoError(t, err)
	svc := app.NewBillingService(repo, app.NewChannelRegistry(), app.Config{Currency: "CNY"}, app.BillingHooks{}, nil,
		func() time.Time { return time.Now().UTC() }, nil).
		WithEventEmitter(adaptEmitter(emitter))

	require.NoError(t, svc.MarkOrderPaid(ctx, nil, orderID))

	var status string
	var paidAt *time.Time
	require.NoError(t, pool.QueryRow(ctx, `SELECT status, paid_at FROM "order" WHERE id = $1`, orderID).Scan(&status, &paidAt))
	assert.Equal(t, "paid", status)
	assert.NotNil(t, paidAt, "核销时间落 paid_at")

	var kind, idem string
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT args->>'kind', args->>'idempotency_key'
		FROM river_job WHERE kind = 'ploykit.event'`).Scan(&kind, &idem))
	assert.Equal(t, app.KindOrderMarkedPaid, kind)
	assert.Equal(t, "billing.order_marked_paid:"+orderID, idem)

	stripeOrder := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO "order" (id, workspace_id, user_id, plan_code, interval, amount_cents, currency, channel, status)
		VALUES ($1, $2, $3, 'pro', 'monthly', 9900, 'CNY', 'stripe', 'pending')`,
		stripeOrder, ws, uid)
	require.NoError(t, err)
	require.Error(t, svc.MarkOrderPaid(ctx, nil, stripeOrder))
	var still string
	require.NoError(t, pool.QueryRow(ctx, `SELECT status FROM "order" WHERE id = $1`, stripeOrder).Scan(&still))
	assert.Equal(t, "pending", still)
}

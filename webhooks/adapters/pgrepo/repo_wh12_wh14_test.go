package pgrepo

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/egressx"
	"github.com/haozing/ploykit/webhooks"
	"github.com/haozing/ploykit/webhooks/app"
)

func deliveryIDByEvent(t *testing.T, pool *pgxpool.Pool, subID, eventID string) string {
	t.Helper()
	var id string
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT id FROM webhook_delivery WHERE subscription_id = $1 AND event_id = $2`,
		subID, eventID).Scan(&id))
	return id
}

func TestRepo_Redeliver_ReusesEventID_WH12(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	other := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})

	n, err := repo.EmitForEvent(ctx, ws, app.OutboundEvent{
		ID: "evt-wh12", Type: "task.created", Payload: map[string]any{"task": "t"},
	})
	require.NoError(t, err)
	require.Equal(t, 1, n)
	srcID := deliveryIDByEvent(t, pool, sub.ID, "evt-wh12")
	_, err = pool.Exec(ctx, `UPDATE webhook_delivery SET status='delivered', delivered_at=now() WHERE id=$1`, srcID)
	require.NoError(t, err)

	got, err := repo.Redeliver(ctx, ws, srcID)
	require.NoError(t, err)
	assert.NotEqual(t, srcID, got.ID, "重投仍是全新投递行（新行 id，非原行复活）")
	assert.Equal(t, "evt-wh12", got.EventID, "WH12：重投必须复用原 event_id（Svix/Convoy/Stripe 三家一致，接收方按 ID 幂等去重）")
	assert.Equal(t, app.StatusPending, got.Status)
	assert.Equal(t, 0, got.Attempts)
	assert.Equal(t, "task.created", got.EventType)

	items, err := repo.ListDeliveries(ctx, ws, 50)
	require.NoError(t, err)
	var sameEvent int
	statuses := map[string]string{}
	for _, d := range items {
		if d.EventID == "evt-wh12" {
			sameEvent++
			statuses[d.Status] = d.ID
		}
	}
	assert.Equal(t, 2, sameEvent, "delivered 旧行 + pending 新行同 event_id 并存可见")
	assert.Contains(t, statuses, app.StatusDelivered)
	assert.Contains(t, statuses, app.StatusPending)

	deadID := got.ID
	_, err = pool.Exec(ctx, `UPDATE webhook_delivery SET status='dead' WHERE id=$1`, deadID)
	require.NoError(t, err)
	again, err := repo.Redeliver(ctx, ws, deadID)
	require.NoError(t, err)
	assert.Equal(t, "evt-wh12", again.EventID)
	assert.Equal(t, app.StatusPending, again.Status)

	before := countRows(t, pool, `SELECT count(*) FROM webhook_delivery WHERE subscription_id = $1 AND event_id = 'evt-wh12'`, sub.ID)
	_, err = repo.Redeliver(ctx, other, srcID)
	assert.ErrorIs(t, err, app.ErrNotFound, "cross-workspace redeliver must be not found")
	assert.Equal(t, before, countRows(t, pool, `SELECT count(*) FROM webhook_delivery WHERE subscription_id = $1 AND event_id = 'evt-wh12'`, sub.ID))

	_, err = repo.Redeliver(ctx, ws, "00000000-0000-0000-0000-000000000000")
	assert.ErrorIs(t, err, app.ErrNotFound)
}

func countRows(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(context.Background(), sql, args...).Scan(&n))
	return n
}

func TestRepo_Redeliver_PendingIdempotent_WH12(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})

	require.NoError(t, repo.EnqueuePing(ctx, ws, sub.ID))
	var eventID string
	var srcID string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT id, event_id FROM webhook_delivery WHERE subscription_id = $1`, sub.ID).Scan(&srcID, &eventID))

	got, err := repo.Redeliver(ctx, ws, srcID)
	require.NoError(t, err)
	assert.Equal(t, srcID, got.ID, "同事件已有 pending：幂等取回既有待投行")
	assert.Equal(t, eventID, got.EventID)
	assert.Equal(t, app.StatusPending, got.Status)
	assert.Equal(t, 1, countRows(t, pool, `SELECT count(*) FROM webhook_delivery WHERE subscription_id = $1`, sub.ID),
		"幂等路径不得新增投递行")

	_, err = pool.Exec(ctx, `UPDATE webhook_delivery SET status='dead' WHERE id=$1`, srcID)
	require.NoError(t, err)
	first, err := repo.Redeliver(ctx, ws, srcID)
	require.NoError(t, err)
	second, err := repo.Redeliver(ctx, ws, srcID)
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID, "并发第二条重投：幂等返回同一 pending 行（ON CONFLICT DO NOTHING，非 409）")
	assert.Equal(t, 2, countRows(t, pool, `SELECT count(*) FROM webhook_delivery WHERE subscription_id = $1`, sub.ID))
}

func TestRepo_EmitForEvent_PartialUnique_WH12(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})
	emit := func() int {
		n, err := repo.EmitForEvent(ctx, ws, app.OutboundEvent{ID: "evt-emit-wh12", Type: "task.created", Payload: map[string]any{}})
		require.NoError(t, err)
		return n
	}

	require.Equal(t, 1, emit(), "首次扇出建一行")
	require.Equal(t, 0, emit(), "pending 期间同 event 重复 Emit：幂等不新增（ON CONFLICT DO NOTHING）")
	srcID := deliveryIDByEvent(t, pool, sub.ID, "evt-emit-wh12")
	_, err := pool.Exec(ctx, `UPDATE webhook_delivery SET status='delivered' WHERE id=$1`, srcID)
	require.NoError(t, err)
	require.Equal(t, 1, emit(), "delivered 后同 event 再 Emit：合法重发（新 pending 行，复用 event_id）")
	require.Equal(t, 0, emit(), "新 pending 期间又幂等")
	assert.Equal(t, 2, countRows(t, pool, `SELECT count(*) FROM webhook_delivery WHERE subscription_id = $1 AND event_id = 'evt-emit-wh12'`, sub.ID))
}

func TestRepo_AdminRedeliver_ReusesEventID_WH12(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})

	n, err := repo.EmitForEvent(ctx, ws, app.OutboundEvent{
		ID: "evt-admin-wh12", Type: "task.created", Payload: map[string]any{"k": 1},
	})
	require.NoError(t, err)
	require.Equal(t, 1, n)
	srcID := deliveryIDByEvent(t, pool, sub.ID, "evt-admin-wh12")
	_, err = pool.Exec(ctx, `UPDATE webhook_delivery SET status='dead' WHERE id=$1`, srcID)
	require.NoError(t, err)

	v, err := repo.AdminRedeliver(ctx, srcID)
	require.NoError(t, err)
	assert.Equal(t, "evt-admin-wh12", v.EventID, "admin 重投同样复用原 event_id")
	assert.Equal(t, app.StatusPending, v.Status)
	assert.Equal(t, ws, v.WorkspaceID, "复制行携带源行 workspace_id")

	again, err := repo.AdminRedeliver(ctx, srcID)
	require.NoError(t, err)
	assert.Equal(t, v.ID, again.ID, "同事件已有 pending：admin 重投幂等取回")
	assert.Equal(t, 2, countRows(t, pool, `SELECT count(*) FROM webhook_delivery WHERE subscription_id = $1 AND event_id = 'evt-admin-wh12'`, sub.ID))

	_, err = repo.AdminRedeliver(ctx, "00000000-0000-0000-0000-000000000000")
	assert.ErrorIs(t, err, app.ErrNotFound)
}

func TestRepo_RotateSecret_WH13(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	other := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})

	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	err := repo.RotateSecret(ctx, ws, sub.ID, "sealed:v1:NEW", now.Add(24*time.Hour), now)
	require.NoError(t, err)

	var secret, oldSecret string
	var expiresAt *time.Time
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT secret, old_secret, old_secret_expires_at FROM webhook_subscription WHERE id = $1`, sub.ID).
		Scan(&secret, &oldSecret, &expiresAt))
	assert.Equal(t, "sealed:v1:NEW", secret)
	assert.Equal(t, "whk_secret_"+ws[:8], oldSecret, "旧钥 = 轮换前的 secret（明文夹具直读验证搬运）")
	require.NotNil(t, expiresAt)
	assert.True(t, expiresAt.Equal(now.Add(24*time.Hour)), "宽限终点 = 轮换时刻 + 24h")

	now2 := now.Add(time.Hour)
	err = repo.RotateSecret(ctx, ws, sub.ID, "sealed:v1:NEWER", now2.Add(24*time.Hour), now2)
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT secret, old_secret FROM webhook_subscription WHERE id = $1`, sub.ID).
		Scan(&secret, &oldSecret))
	assert.Equal(t, "sealed:v1:NEWER", secret)
	assert.Equal(t, "sealed:v1:NEW", oldSecret, "二次轮换：旧钥位接住上一把新钥（单把旧钥语义）")

	err = repo.RotateSecret(ctx, other, sub.ID, "sealed:v1:X", now.Add(24*time.Hour), now)
	assert.ErrorIs(t, err, app.ErrNotFound, "cross-workspace rotate must be not found")
	err = repo.RotateSecret(ctx, ws, "00000000-0000-0000-0000-000000000000", "sealed:v1:X", now.Add(24*time.Hour), now)
	assert.ErrorIs(t, err, app.ErrNotFound)
}

func TestRepo_ClaimPendingCarriesOldSecret_WH13(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})
	require.NoError(t, repo.EnqueuePing(ctx, ws, sub.ID))

	pending, err := repo.ClaimPending(ctx, 10)
	require.NoError(t, err)
	var found bool
	for _, p := range pending {
		if p.SubscriptionID == sub.ID {
			found = true
			assert.Empty(t, p.OldSealed, "从未轮换：OldSealed 为空")
			assert.Nil(t, p.OldExpiresAt, "从未轮换：OldExpiresAt 为 nil")
		}
	}
	require.True(t, found, "ping 投递应可认领")

	now := time.Now().UTC()
	require.NoError(t, repo.RotateSecret(ctx, ws, sub.ID, "sealed:v1:rotated", now.Add(24*time.Hour), now))
	require.NoError(t, repo.EnqueuePing(ctx, ws, sub.ID))
	pending2, err := repo.ClaimPending(ctx, 10)
	require.NoError(t, err)
	found = false
	for _, p := range pending2 {
		if p.SubscriptionID == sub.ID && p.OldSealed != "" {
			found = true
			assert.Equal(t, "whk_secret_"+ws[:8], p.OldSealed, "认领带出旧钥（sealed 形态落库值）")
			require.NotNil(t, p.OldExpiresAt)
		}
	}
	assert.True(t, found, "轮换后的投递认领应带出旧钥")
}

func TestRepo_FailureWindowBookkeeping_WH14(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})
	require.NoError(t, repo.EnqueuePing(ctx, ws, sub.ID))
	dlvID := firstDeliveryOfSub(t, pool, sub.ID)

	ff, err := repo.FirstFailureAt(ctx, sub.ID)
	require.NoError(t, err)
	assert.Nil(t, ff, "初始无失败窗")

	now := time.Now().UTC()
	require.NoError(t, repo.MarkRetry(ctx, dlvID, 500, "HTTP 500", now.Add(time.Minute), false))
	ff, err = repo.FirstFailureAt(ctx, sub.ID)
	require.NoError(t, err)
	require.NotNil(t, ff, "首次失败应开窗")
	firstFF := *ff

	require.NoError(t, repo.MarkRetry(ctx, dlvID, 500, "HTTP 500", now.Add(5*time.Minute), false))
	ff, err = repo.FirstFailureAt(ctx, sub.ID)
	require.NoError(t, err)
	require.NotNil(t, ff)
	assert.True(t, ff.Equal(firstFF), "窗口已开时重复失败不重置起点（连续失败窗语义）")

	require.NoError(t, repo.MarkDelivered(ctx, dlvID, 200, now))
	ff, err = repo.FirstFailureAt(ctx, sub.ID)
	require.NoError(t, err)
	assert.Nil(t, ff, "成功清零失败窗（期间无成功 = 窗口持续）")

	require.NoError(t, repo.MarkRetry(ctx, dlvID, 500, "HTTP 500", now.Add(time.Minute), false))
	ff, err = repo.FirstFailureAt(ctx, sub.ID)
	require.NoError(t, err)
	assert.NotNil(t, ff, "清零后再次失败重新开窗")
}

func firstDeliveryOfSub(t *testing.T, pool *pgxpool.Pool, subID string) string {
	t.Helper()
	var id string
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT id FROM webhook_delivery WHERE subscription_id = $1 ORDER BY created_at LIMIT 1`, subID).Scan(&id))
	return id
}

type e2eSecrets struct{}

func (e2eSecrets) Seal(p string) (string, error) { return "sealed:v1:" + p, nil }

func (e2eSecrets) Unseal(s string) (string, error) {
	if !strings.HasPrefix(s, "sealed:v1:") {
		return "", errors.New("plaintext refused")
	}
	return strings.TrimPrefix(s, "sealed:v1:"), nil
}

func loopbackSvc(t *testing.T, repo *Repo, clock func() time.Time) *app.WebhookService {
	t.Helper()
	svc := app.NewWebhookService(repo, app.NewEventCatalog(), nil, clock).WithSecrets(e2eSecrets{})
	client, err := egressx.NewHTTPClient(egressx.Opts{AllowCIDRs: []string{"127.0.0.0/8"}})
	if err != nil {
		t.Fatalf("egress client: %v", err)
	}
	return svc.WithHTTPClient(client)
}

func TestE2E_RotateDualSignature_WH13(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})

	const oldPlain = "whk_orig"
	_, err := pool.Exec(ctx,
		`UPDATE webhook_subscription SET secret = 'sealed:v1:`+oldPlain+`' WHERE id = $1`, sub.ID)
	require.NoError(t, err)

	now := time.Now().UTC()
	require.NoError(t, repo.RotateSecret(ctx, ws, sub.ID, "sealed:v1:whk_new", now.Add(24*time.Hour), now))

	var gotSigs []string
	var gotTS string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		gotTS = r.Header.Get("X-Timestamp")
		if s := r.Header.Get("X-Signature"); s != "" {
			gotSigs = append(gotSigs, s)
		}
		if s := r.Header.Get("X-Signature-Old"); s != "" {
			gotSigs = append(gotSigs, s)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	_, err = pool.Exec(ctx, `UPDATE webhook_subscription SET url = $2 WHERE id = $1`, sub.ID, srv.URL)
	require.NoError(t, err)

	require.NoError(t, repo.EnqueuePing(ctx, ws, sub.ID))
	loopbackSvc(t, repo, func() time.Time { return now }).DeliverPending(ctx, 10)

	ts, err := time.Parse(time.RFC3339Nano, gotTS)
	require.NoError(t, err)
	require.Len(t, gotSigs, 2, "宽限期内应携带 X-Signature + X-Signature-Old 双签名")
	assert.True(t, app.VerifySignAny([]string{"whk_new", oldPlain}, ts, gotBody, gotSigs[0]),
		"接收方 VerifySignAny 双候选应验过第一个签名头")
	assert.True(t, app.VerifySignAny([]string{"whk_new", oldPlain}, ts, gotBody, gotSigs[1]),
		"接收方 VerifySignAny 双候选应验过第二个签名头")
	var status string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT status FROM webhook_delivery WHERE subscription_id = $1`, sub.ID).Scan(&status))
	assert.Equal(t, app.StatusDelivered, status, "双签名投递应成功")

	now2 := time.Now().UTC()
	require.NoError(t, repo.RotateSecret(ctx, ws, sub.ID, "sealed:v1:whk_newer", now2.Add(-time.Hour), now2))
	gotSigs = nil
	require.NoError(t, repo.EnqueuePing(ctx, ws, sub.ID))
	loopbackSvc(t, repo, func() time.Time { return now2 }).DeliverPending(ctx, 10)
	require.Len(t, gotSigs, 1, "旧钥过期后只携带 X-Signature（单签名）")
	assert.True(t, app.VerifySign("whk_newer", mustParseTS(t, gotTS), gotBody, gotSigs[0]))
}

func mustParseTS(t *testing.T, ts string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339Nano, ts)
	require.NoError(t, err)
	return parsed
}

func TestE2E_AutoDisableAfterContinuousFailures_WH14(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	wsCtl := mkFixture(t, pool)

	victim := mkSub(t, repo, ws, []string{"task.created"})
	ctl := mkSub(t, repo, wsCtl, []string{"task.created"})

	frozen := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	_, err := pool.Exec(ctx,
		`UPDATE webhook_subscription SET first_failure_at = $2 WHERE id = $1`,
		victim.ID, frozen.Add(-app.AutoDisableWindow-time.Hour))
	require.NoError(t, err)

	require.NoError(t, repo.EnqueuePing(ctx, ws, victim.ID))
	require.NoError(t, repo.EnqueuePing(ctx, wsCtl, ctl.ID))

	var hookFired []string
	svc := loopbackSvc(t, repo, func() time.Time { return frozen })

	svc = svc.WithHooks(webhooks.WebhookHooks{
		OnSubscriptionDisabled: func(_ context.Context, workspaceID, subscriptionID string) error {
			hookFired = append(hookFired, workspaceID+"/"+subscriptionID)
			return nil
		},
	})

	for i := 0; i < 6; i++ {
		svc.DeliverPending(ctx, 10)
	}

	var victimActive, ctlActive, victimStatus, ctlStatus string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT s.is_active::text, d.status FROM webhook_subscription s
		 JOIN webhook_delivery d ON d.subscription_id = s.id WHERE s.id = $1`, victim.ID).
		Scan(&victimActive, &victimStatus))
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT s.is_active::text, d.status FROM webhook_subscription s
		 JOIN webhook_delivery d ON d.subscription_id = s.id WHERE s.id = $1`, ctl.ID).
		Scan(&ctlActive, &ctlStatus))
	assert.Equal(t, app.StatusDead, victimStatus, "victim 投递应进入死信")
	assert.Equal(t, "false", victimActive, "连续失败窗满 → 自动停用（SetSubscriptionActive(false)）")
	assert.Equal(t, app.StatusDead, ctlStatus, "对照订阅同样死信")
	assert.Equal(t, "true", ctlActive, "无失败窗（期间曾成功/无窗）→ 不禁用")
	require.Len(t, hookFired, 1, "自动停用应经 OnSubscriptionDisabled 钩子路径触发恰好一次")
	assert.Equal(t, ws+"/"+victim.ID, hookFired[0], "钩子参数应为归属工作区/被停订阅")
}

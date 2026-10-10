package audit

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

// RecordTx 合同：审计写入与调用方事务同生共死（提交即落库、回滚即消失），
// 且 SQL 语义与 Record 同源（actor 解析 / snapshot / request_id 一致）。
func TestRecordTx_SameTxLifecycle(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	rec := NewRecorder(pool, nil)
	ws := uuid.New() // 任意 UUID：audit_event.workspace_id 不做外键约束，仅做租户隔离维度
	wsStr := ws.String()
	p := &webx.Principal{UserID: "u-tx", Email: "tx@test.local", Source: webx.SourcePAT, WorkspaceID: wsStr, Role: "owner"}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM audit_event WHERE workspace_id = $1`, ws) })

	count := func(q interface {
		QueryRow(context.Context, string, ...any) pgx.Row
	}) int {
		var n int
		require.NoError(t, q.QueryRow(ctx,
			`SELECT count(*) FROM audit_event WHERE workspace_id = $1 AND action = 'tx.probe'`, ws).Scan(&n))
		return n
	}

	// 回滚路径：事务内可见，回滚后消失
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx) // no-op after commit；防止断言失败时挂死 pool.Close
	require.NoError(t, rec.RecordTx(WithRequestID(ctx, "req-tx-1"), tx, &wsStr, p, "tx.probe", "thing", "t-1", nil))
	assert.Equal(t, 1, count(tx), "事务内应可见")
	require.NoError(t, tx.Rollback(ctx))
	assert.Equal(t, 0, count(pool), "回滚后不应落库")

	// 提交路径：提交后对池可见，且 actor/request_id 语义与 Record 同源
	tx, err = pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)
	require.NoError(t, rec.RecordTx(WithRequestID(ctx, "req-tx-2"), tx, &wsStr, p, "tx.probe", "thing", "t-2", nil))
	require.NoError(t, tx.Commit(ctx))
	assert.Equal(t, 1, count(pool))

	var actorType, actorID, reqID string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT actor_type, actor_id, request_id FROM audit_event WHERE workspace_id = $1 AND action = 'tx.probe'`, ws).
		Scan(&actorType, &actorID, &reqID))
	assert.Equal(t, "pat", actorType)
	assert.Equal(t, "u-tx", actorID)
	assert.Equal(t, "req-tx-2", reqID)
}

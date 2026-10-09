package pg

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubTx struct{ pgx.Tx }

type recordingBeginner struct{ begins atomic.Int32 }

func (b *recordingBeginner) Begin(context.Context) (pgx.Tx, error) {
	b.begins.Add(1)
	return nil, errors.New("recordingBeginner: Begin 不应被到达（守卫必须先拒）")
}

func TestWithTenantRejectsPlainTxScope(t *testing.T) {
	ctx := context.WithValue(context.Background(), txKey{}, stubTx{})
	b := &recordingBeginner{}
	err := WithTenant(ctx, b, Identity{WorkspaceID: uuid.New(), UserID: uuid.New()},
		func(context.Context, pgx.Tx) error { return nil })
	require.Error(t, err, "Within 事务内调 WithTenant 应被拒绝（P2-4）")
	assert.Contains(t, err.Error(), "inside an existing transaction")
	assert.Zero(t, b.begins.Load(), "守卫必须在 Begin 之前拒绝——跨连接第二事务是半提交+死锁源")
}

func TestWithServiceRejectsPlainTxScope(t *testing.T) {
	ctx := context.WithValue(context.Background(), txKey{}, stubTx{})
	b := &recordingBeginner{}
	err := WithService(ctx, b, func(context.Context, pgx.Tx) error { return nil })
	require.Error(t, err, "Within 事务内调 WithService 应被拒绝（P2-4）")
	assert.Contains(t, err.Error(), "inside an existing transaction")
	assert.Zero(t, b.begins.Load(), "守卫必须在 Begin 之前拒绝")
}

func TestReadInsideTxReusesTx(t *testing.T) {
	tx := stubTx{}
	ctx := context.WithValue(context.Background(), txKey{}, tx)
	d := &DB{primary: &pgxpool.Pool{}, breaker: newBreaker()}
	var got DBTX
	require.NoError(t, d.Read(ctx, func(_ context.Context, q DBTX) error { got = q; return nil }))
	assert.Equal(t, DBTX(tx), got, "事务内 Read 必须复用当前事务而非直落池/副本")
}

type wdFake struct {
	probeErr error
	pingErr  error
	statVal  wdStat
	resets   int
	exits    int
}

func (f *wdFake) harness() *wdHarness {
	return &wdHarness{
		probe: func() error { return f.probeErr },
		ping:  func() error { return f.pingErr },
		stat:  func() wdStat { return f.statVal },
		reset: func() { f.resets++ },
		exit:  func() { f.exits++ },
	}
}

func TestWatchdogTickMatrix(t *testing.T) {
	t.Run("合法满载_饱和且有周转_不计wedge不Reset", func(t *testing.T) {
		f := &wdFake{pingErr: errors.New("acquire timeout"), statVal: wdStat{acquired: 4, idle: 0, max: 4, emptyAcquires: 10}}
		h := f.harness()
		h.tick(false)
		assert.Equal(t, 0, f.resets, "满载不 Reset（回收不到 idle 只会打断在途查询）")
		assert.Equal(t, 0, h.wedges, "满载不计 wedge")

		f.statVal.emptyAcquires = 25
		h.tick(true)
		f.statVal.emptyAcquires = 40
		h.tick(true)
		assert.Equal(t, 0, f.resets)
		assert.Equal(t, 0, f.exits, "持续满载不得触发 ExitOnWedge 误杀（P2-5 主场景）")
	})

	t.Run("饱和但无周转_判楔死_计数加Reset", func(t *testing.T) {

		f := &wdFake{statVal: wdStat{acquired: 4, idle: 0, max: 4, emptyAcquires: 10}}
		h := f.harness()
		h.tick(false)
		f.pingErr = errors.New("acquire timeout")
		h.tick(false)
		assert.Equal(t, 1, h.wedges, "饱和+周转冻结 = 楔死")
		assert.Equal(t, 1, f.resets)
		assert.Equal(t, int64(10), h.lastEmptyAcq, "周转基线须更新（下轮比较依据）")
	})

	t.Run("未饱和的Ping失败_仍判楔死", func(t *testing.T) {

		f := &wdFake{pingErr: errors.New("conn refused"), statVal: wdStat{acquired: 2, idle: 0, max: 4, emptyAcquires: 10}}
		h := f.harness()
		h.tick(false)
		assert.Equal(t, 1, h.wedges)
		assert.Equal(t, 1, f.resets)
	})

	t.Run("连续wedgeThreshold轮且ExitOnWedge_退出恰好一次", func(t *testing.T) {
		f := &wdFake{statVal: wdStat{acquired: 4, idle: 0, max: 4, emptyAcquires: 10}}
		h := f.harness()
		h.tick(false)
		f.pingErr = errors.New("acquire timeout")
		for i := 0; i < 3; i++ {
			h.tick(true)
		}
		assert.Equal(t, 3, f.resets)
		assert.Equal(t, 1, f.exits, "连续 3 轮楔死 + ExitOnWedge → 退出")
		h.tick(true)
		assert.Equal(t, 1, f.exits)
	})

	t.Run("wedge未达阈值_ExitOnWedge不触发", func(t *testing.T) {
		f := &wdFake{statVal: wdStat{acquired: 4, idle: 0, max: 4, emptyAcquires: 10}}
		h := f.harness()
		h.tick(false)
		f.pingErr = errors.New("acquire timeout")
		h.tick(true)
		h.tick(true)
		assert.Equal(t, 2, h.wedges)
		assert.Equal(t, 0, f.exits)
	})

	t.Run("健康tick清零计数", func(t *testing.T) {
		f := &wdFake{statVal: wdStat{acquired: 4, idle: 0, max: 4, emptyAcquires: 10}}
		h := f.harness()
		h.tick(false)
		f.pingErr = errors.New("acquire timeout")
		h.tick(false)
		h.tick(false)
		f.pingErr = nil
		h.tick(true)
		assert.Equal(t, 0, h.wedges, "健康 tick 清零连续计数")
		h.tick(true)
		h.tick(true)
		assert.Equal(t, 0, f.exits, "2+健康穿插后不再连续，不得退出")
	})

	t.Run("DB不可达_Reset且计数清零", func(t *testing.T) {
		f := &wdFake{probeErr: errors.New("dial tcp: refuse"), statVal: wdStat{acquired: 4, idle: 0, max: 4, emptyAcquires: 10}}
		h := f.harness()
		h.wedges = 2
		h.tick(true)
		assert.Equal(t, 1, f.resets, "DB 不可达 → Reset 清理池内半开连接")
		assert.Equal(t, 0, h.wedges, "不可达与楔死是不同故障，计数不串联")
		assert.Equal(t, 0, f.exits)
	})

	t.Run("慢泄漏权衡_周转归零后仍被计wedge", func(t *testing.T) {

		f := &wdFake{pingErr: errors.New("acquire timeout"), statVal: wdStat{acquired: 4, idle: 0, max: 4, emptyAcquires: 10}}
		h := f.harness()
		f.statVal.emptyAcquires = 11
		h.tick(true)
		assert.Equal(t, 0, h.wedges, "慢泄漏窗口内暂判满载（知情权衡）")
		h.tick(true)
		assert.Equal(t, 1, h.wedges, "周转归零 → 判楔死")
	})
}

func TestWithinWithTenantInteractionDB(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	err := db.Within(ctx, func(ctx context.Context) error {
		return WithTenant(ctx, db, Identity{WorkspaceID: uuid.New(), UserID: uuid.New()},
			func(context.Context, pgx.Tx) error { return nil })
	})
	require.Error(t, err, "Within 内的 WithTenant 必须被拒绝（P2-4 端到端）")
	assert.Contains(t, err.Error(), "inside an existing transaction")

	require.NoError(t, db.Within(ctx, func(ctx context.Context) error {
		_, err := db.Tx(ctx).Exec(ctx, `SELECT 1`)
		return err
	}))
}

func TestReadInsideWithTenantSeesGUCDB(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	id := Identity{WorkspaceID: uuid.New(), UserID: uuid.New()}
	var got string

	require.NoError(t, WithTenant(ctx, db, id, func(ctx context.Context, tx pgx.Tx) error {
		return db.Read(ctx, func(ctx context.Context, q DBTX) error {
			return q.QueryRow(ctx, `SELECT current_setting('`+gucWorkspaceID+`', true)`).Scan(&got)
		})
	}), "事务内 Read 应复用事务而非直落池（直落池时 GUC 丢失、RLS fail-closed 0 行）")
	assert.Equal(t, id.WorkspaceID.String(), got, "Read 在租户事务内必须看得见 GUC")
}

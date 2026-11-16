package quota

// F-QTA-01 尾巴：跨月配额时钟推进测试（消费在 10 月、释放时钟已到 11 月）。
//
// 出处与机制：
//   - round4 审计 P3（docs/delivery-audit-video-studio-2026-11-15.md §4 P3 +
//     跨月错账分析）：旧 API Release（quota.go，consume_tx.go 对照面）用
//     Period(now)（当前月）绑定计数行——月初/月末边界下 10/31 消费、11/1
//     失败释放 → 释放减到 11 月计数（或匹配不到行、静默 0 行）→ 10 月支出
//     永不退回。GREATEST(0, used-n) 保证纯递减下限为 0（migration 006 的
//     CHECK (used >= 0) 否则会直接 abort）。
//   - round3 已落地修复面：ReleaseTx(ctx, tx, ws, key, n, period)（caller
//     Commit 语义，audit §4 P2）与 ReleasePeriod(...)（后台补偿路径）带
//     显式 consumption-time period（quota/consume_tx.go）。
//   - 本文件补上"显式 period 在跨月场景命中正确的行"的证明（此前只有机制
//     落地、无测试）。与并行批 8-3（example video reconciler 跨月测试）
//     分工：本文件只在 quota 包层——fake/真库都不进 render 包。
//
// 结构：§1 纯单元（recordingTx 最小 stub，不碰 DB）+ §2 DB 集成
// （TEST_DATABASE_URL 门控，对齐既有 *_db_test.go 模式）。

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// §1 纯单元：fake execer / fake pgx.Tx
// ---------------------------------------------------------------------------

// recordingTx 是 ReleaseTx 契约面（pgx.Tx，见 consume_tx.go:24-26 "tx must
// be a pgx.Tx"）的最小 stub：只记录 Exec 的 SQL 与参数，其余方法一律拒绝
// （ReleaseTx 只走 Exec，其余路径在本测试中不存在）。consume.go 内部的
// execer 小接口是 consumeOnce 的面；ReleaseTx 的面是完整 pgx.Tx，故这里
// stub 实现的是 pgx.Tx。
type recordingTx struct {
	sql  string
	args []any
}

func (t *recordingTx) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	t.sql = sql
	t.args = args
	// pgconn.NewCommandTag("UPDATE 1") → RowsAffected()==1
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func (t *recordingTx) Begin(context.Context) (pgx.Tx, error) { return t, nil }
func (t *recordingTx) Commit(context.Context) error          { return nil }
func (t *recordingTx) Rollback(context.Context) error        { return nil }

func (t *recordingTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	return 0, errors.New("recordingTx: CopyFrom not supported")
}
func (t *recordingTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults {
	return nil
}
func (t *recordingTx) LargeObjects() pgx.LargeObjects { return pgx.LargeObjects{} }
func (t *recordingTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	return nil, errors.New("recordingTx: Prepare not supported")
}
func (t *recordingTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("recordingTx: Query not supported")
}
func (t *recordingTx) QueryRow(context.Context, string, ...any) pgx.Row { return nil }
func (t *recordingTx) Conn() *pgx.Conn                                  { return nil }

// 用例 a（+d 的 SQL 文本半边）：ReleaseTx 传显式 period="2026-10" → SQL
// 参数里绑到 period 的正是 "2026-10"，而非 Period(now)="2026-11"。
// 机制出处：round3 quota/consume_tx.go ReleaseTx；错账出处：round4 §4 P3。
//
// 注：ReleaseTx 签名不接收时钟（无 now 参数）——签名层面就杜绝了
// Period(now) 泄漏；本断言把"period 完全是调用方给的"钉进参数序。
func TestReleaseTx_ExplicitPeriodArgs_FQTA01(t *testing.T) {
	svc := NewService(nil) // ReleaseTx 不触碰 pool，nil 安全
	rec := &recordingTx{}

	err := svc.ReleaseTx(context.Background(), rec, "ws-1", "video_render", 3, "2026-10")
	require.NoError(t, err)

	// 参数序 = SQL 占位序：$1 ws、$2 period、$3 key、$4 n
	require.Equal(t, []any{"ws-1", "2026-10", "video_render", int64(3)}, rec.args,
		"显式 period 必须原样绑到 $2——任何 Period(now) 推导都会在这里显形")
	assert.Equal(t, "2026-10", rec.args[1], "跨月场景：释放目标是消费时的 10 月行，不是当前的 11 月")
}

// 用例 a 的加强版：period 完全由调用方给定、与时钟无关——传任意历史周期
// （2025-01）也必须原样落参。这保证"消费在多久以前、释放就退回多久以前"，
// 无论测试何时运行（对照：旧 API Release 绑 Period(now)，见 §2 的对照半边）。
func TestReleaseTx_PeriodCallerFixed_FQTA01(t *testing.T) {
	svc := NewService(nil)
	rec := &recordingTx{}

	err := svc.ReleaseTx(context.Background(), rec, "ws-1", "video_render", 2, "2025-01")
	require.NoError(t, err)
	assert.Equal(t, "2025-01", rec.args[1], "period 是纯调用方输入，不掺任何时钟推导")
	assert.Equal(t, int64(2), rec.args[3], "n 原样透传（退回量）")
}

// 用例 d（SQL 文本断言）：下限语义 GREATEST(0, used-n)——纯递减钳 0，
// round4 P3 的"纯递减"语义；migration 006 CHECK (used >= 0) 下没有
// GREATEST 会在超退时直接 abort。
// 同时断言 period 是 WHERE 行选择条件（$2），即"选哪行"由 period 决定。
func TestReleaseTx_GreatestFloorText_FQTA01(t *testing.T) {
	svc := NewService(nil)
	rec := &recordingTx{}

	require.NoError(t, svc.ReleaseTx(context.Background(), rec, "ws-1", "video_render", 5, "2026-10"))
	assert.Contains(t, rec.sql, "GREATEST(0, used - $4)",
		"F-QTA-01/d：下限语义必须留在 SQL 文本里（钳 0，不越退为负）")
	assert.Contains(t, rec.sql, "WHERE workspace_id = $1 AND period = $2 AND counter_key = $3",
		"行选择由显式 period（$2）决定——这是跨月命中正确行的机制所在")
}

// 用例 c：Period() 月界（UTC）。F-QTA-01 的时钟 seam：10/31 23:59:59 → 10 月、
// 11/01 00:00:01 → 11 月。既有 TestPeriod（quota_test.go）未覆盖 10→11 这对
// 精确 seam，此处按 F-QTA-01 场景补齐；另补两条边界形态：精确 00:00:00 瞬间
// 与非 UTC 时区（月界按 UTC 判——北京时间 11/1 早晨在 UTC 仍是 10 月）。
func TestPeriod_MonthBoundary_FQTA01(t *testing.T) {
	cases := []struct {
		name string
		now  time.Time
		want string
	}{
		{"10月最后一纳秒", time.Date(2026, 10, 31, 23, 59, 59, 999999999, time.UTC), "2026-10"},
		{"10月末秒", time.Date(2026, 10, 31, 23, 59, 59, 0, time.UTC), "2026-10"},
		{"11月第一纳秒", time.Date(2026, 11, 1, 0, 0, 0, 1, time.UTC), "2026-11"},
		{"11月整点瞬间", time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), "2026-11"},
		{"11月初秒（F-QTA-01 seam）", time.Date(2026, 11, 1, 0, 0, 1, 0, time.UTC), "2026-11"},
		{"非UTC时区月界按UTC判", time.Date(2026, 11, 1, 6, 0, 0, 0, time.FixedZone("CST", 8*3600)), "2026-10"},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, Period(c.now), "Period(%s)=%v", c.name, c.now)
	}
}

// 用例 b 的机制半边（单元层）：旧 API Release 绑 $2 用的是 Period(now)
// ——时钟推进到 11 月，它绑的就是 "2026-11"。此为"错误用法会产生什么"
// 的对照记录：后果半边（10 月行纹丝不动）见 §2 集成测试 Phase 1。
// 出处：quota.go Release（round4 §4 P3 指认的错账面）。
func TestRelease_OldAPI_BindsCurrentMonthPeriod_FQTA01(t *testing.T) {
	consumedClock := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	releaseClock := time.Date(2026, 11, 1, 0, 0, 1, 0, time.UTC)

	// Release 的实现就是 args[1] = Period(now)：消费钟与释放钟同月则对账，
	// 跨月则错账。断言机制本身：
	assert.Equal(t, "2026-10", Period(consumedClock), "消费固定在 10 月")
	assert.Equal(t, "2026-11", Period(releaseClock), "释放时钟推进后 Release 只会绑 11 月——10 月行不在它的 WHERE 里")
	assert.NotEqual(t, Period(consumedClock), Period(releaseClock),
		"跨月 seam 成立：同一笔消费的释放钟已换月，旧 API 必然错过原计数行")
}

// ---------------------------------------------------------------------------
// §2 DB 集成：显式 period 修复跨月错账的直接证明
//（TEST_DATABASE_URL 门控，对齐既有 *_db_test.go；make -C example db-up 先行）
// ---------------------------------------------------------------------------

// 真库两行计数（10 月 used=3、11 月 used=0）：
//   Phase 1（对照，用例 b 后果半边）：Release(now=11-01) → 10 月行纹丝不动
//     （WHERE period='2026-11' 匹配不到 10 月行）——round4 P3 指认的
//     "10 月支出永不退回"现状取证；
//   Phase 2（修复证明，用例 a）：ReleaseTx(period="2026-10", n=5) → 10 月行
//     3 → 0（GREATEST 钳 0，n>used 不越负）、11 月行不动；
//   Phase 3：再 Release(now=11-01) → 两行皆不动（旧 API 结构上碰不到 10 月行）；
//   Phase 4：ReleasePeriod（round3 后台补偿变体，render worker 的实际路径）
//     同样按显式 period 退对行。
func TestReleaseTx_CrossMonthRefund_DB_FQTA01(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	svc := NewService(pool)

	const key = "video_render"
	consumedAt := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC) // 消费在 10 月
	releaseClock := time.Date(2026, 11, 1, 0, 0, 1, 0, time.UTC) // 释放时钟已到 11 月

	// 种子：10 月行 used=3（模拟 10/31 的三次消费），11 月行 used=0
	_, err := pool.Exec(ctx, `
		INSERT INTO quota_counter (workspace_id, period, counter_key, used)
		VALUES ($1, '2026-10', $2, 3), ($1, '2026-11', $2, 0)`, ws, key)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM quota_counter WHERE workspace_id = $1 AND counter_key = $2`, ws, key)
	})

	readUsed := func(t *testing.T, period string) int64 {
		t.Helper()
		var used int64
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT used FROM quota_counter WHERE workspace_id = $1 AND period = $2 AND counter_key = $3`,
			ws, period, key).Scan(&used), "读取 %s 计数行", period)
		return used
	}

	// ---- Phase 1：对照——旧 API Release(now=11月) 错过 10 月行（现状取证）----
	require.NoError(t, svc.Release(ctx, ws, key, 5, releaseClock))
	assert.Equal(t, int64(3), readUsed(t, "2026-10"),
		"round4 P3 错账取证：Release 绑 Period(now)='2026-11'，匹配不到 10 月行——支出永不退回（静默 0 行影响）")
	assert.Equal(t, int64(0), readUsed(t, "2026-11"),
		"旧 API 退的是 11 月行（此刻 used=0，GREATEST 钳 0）——退错对象")

	// ---- Phase 2：修复证明——ReleaseTx 显式 period="2026-10" 命中正确行 ----
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	require.NoError(t, svc.ReleaseTx(ctx, tx, ws, key, 5, Period(consumedAt)))
	require.NoError(t, tx.Commit(ctx), "callerCommit：释放随调用方事务提交（round3，audit §4 P2）")
	assert.Equal(t, int64(0), readUsed(t, "2026-10"),
		"显式 period 命中 10 月行；n=5 > used=3 被 GREATEST(0, used-n) 钳到 0（CHECK used>=0 未触发 abort）")
	assert.Equal(t, int64(0), readUsed(t, "2026-11"),
		"11 月行分文未动——释放没有泄漏到当前月")

	// ---- Phase 3：任务原样断言——再 Release(now=11月)，11 月行不变 ----
	require.NoError(t, svc.Release(ctx, ws, key, 5, releaseClock))
	assert.Equal(t, int64(0), readUsed(t, "2026-11"), "Release 只会碰 11 月行，值不变")
	assert.Equal(t, int64(0), readUsed(t, "2026-10"), "Release 结构上匹配不到 10 月的行")

	// ---- Phase 4：ReleasePeriod（后台补偿路径）同样按显式 period 退对行 ----
	_, err = pool.Exec(ctx, `
		UPDATE quota_counter SET used = 2 WHERE workspace_id = $1 AND period = '2026-10' AND counter_key = $2`, ws, key)
	require.NoError(t, err)
	require.NoError(t, svc.ReleasePeriod(ctx, ws, key, 2, Period(consumedAt)))
	assert.Equal(t, int64(0), readUsed(t, "2026-10"), "非 Tx 后台补偿变体同样退对 10 月行")
	assert.Equal(t, int64(0), readUsed(t, "2026-11"), "11 月行保持不变")
}

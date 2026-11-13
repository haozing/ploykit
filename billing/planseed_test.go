package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pgmigrate"
)

// newPlanSeedTestPool 建一个一次性数据库跑全量框架迁移——SeedPlans 的测试要
// 看到真实 plan 表（007 的 free/pro 基线 + CHECK 约束），共享 dev 库里动
// free/pro 会污染别的套件。TEST_DATABASE_URL 缺省时自跳过（与全仓 DB 测试约定
// 一致）；dev compose 的 pk 用户是 superuser，可建/删 scratch 库。
func newPlanSeedTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	admin, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	scratch := "billing_planseed_" + uuid.NewString()[:8]
	_, err = admin.Exec(ctx, "CREATE DATABASE "+scratch)
	require.NoError(t, err, "scratch db（dev compose 用户 pk 是 superuser）")

	u, err := url.Parse(dsn)
	require.NoError(t, err)
	u.Path = "/" + scratch
	pool, err := pgxpool.New(ctx, u.String())
	require.NoError(t, err)
	require.NoError(t, pgmigrate.Up(ctx, pool, migrations.FS, "."))

	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer dropCancel()
		_, _ = admin.Exec(dropCtx, fmt.Sprintf("DROP DATABASE %s WITH (FORCE)", scratch))
		admin.Close()
	})
	return pool
}

type planRow struct {
	Name     string
	Limits   map[string]int
	SortNo   int
	Currency string
}

func readPlanRow(t *testing.T, pool *pgxpool.Pool, code string) planRow {
	t.Helper()
	var (
		row       planRow
		limitsRaw []byte
	)
	err := pool.QueryRow(context.Background(),
		`SELECT name, limits, sort_no, currency FROM plan WHERE code = $1`, code).
		Scan(&row.Name, &limitsRaw, &row.SortNo, &row.Currency)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(limitsRaw, &row.Limits))
	return row
}

func countPlanRows(t *testing.T, pool *pgxpool.Pool, code string) int {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT count(*) FROM plan WHERE code = $1`, code).Scan(&n))
	return n
}

// 覆盖 (a) 空库首次 seed 生效：fresh 库上 007 先落中文/CNY 基线，SeedPlans
// 一次调用同时覆盖基线行（UPDATE）并新建产品自有 plan（INSERT）。
func TestSeedPlans_FirstSeedOnFreshCatalog(t *testing.T) {
	pool := newPlanSeedTestPool(t)
	ctx := context.Background()

	// 基线就是本 API 要消灭的东西：框架迁移落了中文名 + CNY。
	baseline := readPlanRow(t, pool, "free")
	require.Equal(t, "免费版", baseline.Name)
	require.Equal(t, "CNY", baseline.Currency)

	const newCode = "seed_fresh"
	require.NoError(t, SeedPlans(ctx, pool, nil, []PlanSeed{
		{
			Code: newCode, Name: "Seed Fresh", Currency: "usd",
			Limits: map[string]int{"workspaces": 1, "tasks_monthly": 50}, SortNo: 7,
		},
		{Code: "free", Name: "Free", Currency: "USD"},
		{Code: "pro", Name: "Pro", Currency: "USD"},
	}))

	got := readPlanRow(t, pool, newCode)
	assert.Equal(t, planRow{
		Name: "Seed Fresh", Currency: "USD", SortNo: 7,
		Limits: map[string]int{"workspaces": 1, "tasks_monthly": 50},
	}, got, "新 code 走 INSERT 路径，声明字段全部生效（currency 小写归一化为大写）")

	free := readPlanRow(t, pool, "free")
	assert.Equal(t, "Free", free.Name)
	assert.Equal(t, "USD", free.Currency)
	assert.Equal(t, baseline.Limits, free.Limits, "未声明 limits = 保留 007 的 free 语义")
	assert.Equal(t, baseline.SortNo, free.SortNo, "未声明 sort_no = 保留基线排序")

	pro := readPlanRow(t, pool, "pro")
	assert.Equal(t, "Pro", pro.Name)
	assert.Equal(t, "USD", pro.Currency)
	assert.Equal(t, map[string]int{"workspaces": -1, "tasks_monthly": -1}, pro.Limits,
		"未声明 limits = 保留 007 的 pro 无限语义")
}

// 覆盖 (b) 重复调用幂等：同 seeds 连调两次，既有覆盖行（free）与新建行
// （seed_idem）都必须收敛到同一状态，且不会插出重复 code。
func TestSeedPlans_RepeatIsIdempotent(t *testing.T) {
	pool := newPlanSeedTestPool(t)
	ctx := context.Background()
	seeds := []PlanSeed{
		{Code: "free", Name: "Free", Currency: "USD", Limits: map[string]int{"tasks_monthly": 50}, SortNo: 1},
		{Code: "seed_idem", Name: "Idem", Currency: "USD", Limits: map[string]int{"tasks_monthly": 10}, SortNo: 3},
	}

	require.NoError(t, SeedPlans(ctx, pool, nil, seeds))
	firstFree, firstNew := readPlanRow(t, pool, "free"), readPlanRow(t, pool, "seed_idem")

	require.NoError(t, SeedPlans(ctx, pool, nil, seeds))
	assert.Equal(t, firstFree, readPlanRow(t, pool, "free"), "第二次调用后 free 行必须与第一次完全一致")
	assert.Equal(t, firstNew, readPlanRow(t, pool, "seed_idem"), "INSERT 路径二次调用转 UPDATE，结果一致")
	assert.Equal(t, 1, countPlanRows(t, pool, "free"))
	assert.Equal(t, 1, countPlanRows(t, pool, "seed_idem"))
}

// 覆盖 (c) 部分字段覆盖：只改 name 不动 limits/currency/sort；limits 按键
// 合并而不是整块替换；只给 code 的种子不产生任何改动。
func TestSeedPlans_PartialFieldsKeepStoredValues(t *testing.T) {
	pool := newPlanSeedTestPool(t)
	ctx := context.Background()
	const code = "seed_partial"

	require.NoError(t, SeedPlans(ctx, pool, nil, []PlanSeed{{
		Code: code, Name: "Free", Currency: "USD",
		Limits: map[string]int{"workspaces": 1, "tasks_monthly": 50}, SortNo: 2,
	}}))
	base := readPlanRow(t, pool, code)

	require.NoError(t, SeedPlans(ctx, pool, nil, []PlanSeed{{Code: code, Name: "Starter"}}))
	got := readPlanRow(t, pool, code)
	assert.Equal(t, "Starter", got.Name)
	assert.Equal(t, base.Currency, got.Currency, "空 currency = 保留库内现值")
	assert.Equal(t, base.Limits, got.Limits, "nil limits = 不动 limits")
	assert.Equal(t, base.SortNo, got.SortNo, "0 sort_no = 保留库内排序")

	// limits 是按键合并：只改 tasks_monthly，workspaces 必须还在。
	require.NoError(t, SeedPlans(ctx, pool, nil, []PlanSeed{{
		Code: code, Limits: map[string]int{"tasks_monthly": 500},
	}}))
	got = readPlanRow(t, pool, code)
	assert.Equal(t, planRow{
		Name: "Starter", Currency: "USD", SortNo: 2,
		Limits: map[string]int{"workspaces": 1, "tasks_monthly": 500},
	}, got, "部分 limits 合并而非整块替换")

	// 只声明 code：空种子不得产生任何字段变化。
	require.NoError(t, SeedPlans(ctx, pool, nil, []PlanSeed{{Code: code}}))
	assert.Equal(t, got, readPlanRow(t, pool, code))
}

// 新增 plan 必须显式声明 currency：否则会静默继承列默认值 CNY——正是本 API
// 要消灭的 bug。失败时不得留下半行。
func TestSeedPlans_NewCodeRequiresCurrency(t *testing.T) {
	pool := newPlanSeedTestPool(t)
	ctx := context.Background()

	err := SeedPlans(ctx, pool, nil, []PlanSeed{{Code: "seed_no_currency", Name: "No Currency"}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "declares no currency")
	assert.Zero(t, countPlanRows(t, pool, "seed_no_currency"), "校验失败不得写出半行")
}

// 无 DB 的校验面：空 seeds 是无操作（nil pool 也合法），坏种子在碰库之前就
// 报错。
func TestSeedPlans_ValidationNoDB(t *testing.T) {
	ctx := context.Background()
	require.NoError(t, SeedPlans(ctx, nil, nil, nil), "空 seeds 必须是无操作")

	cases := map[string]PlanSeed{
		"empty code":     {Code: "   "},
		"bad currency":   {Code: "x", Currency: "US"},
		"three decimal":  {Code: "x", Currency: "KWD"},
		"bad limits key": {Code: "x", Limits: map[string]int{"Bad-Key": 1}},
		"long code":      {Code: strings.Repeat("a", 65)},
	}
	for name, seed := range cases {
		t.Run(name, func(t *testing.T) {
			err := SeedPlans(ctx, nil, nil, []PlanSeed{seed})
			require.Error(t, err)
			assert.NotContains(t, err.Error(), "nil pool", "校验必须先于 pool 使用")
		})
	}
}

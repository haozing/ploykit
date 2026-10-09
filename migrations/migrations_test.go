package migrations

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/pg"
	pgm "github.com/haozing/ploykit/platform/pgmigrate"
)

func testMigrator(t *testing.T) (*pgxpool.Pool, *pgm.Migrator) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { db.Close() })
	pool := db.Pool()
	m := pgm.New(pool, FS, ".")
	_, err = m.Up(ctx, 0)
	require.NoError(t, err, "基线：全量 up 自举（幂等）")
	return pool, m
}

func rollbackAbove(t *testing.T, m *pgm.Migrator, pool *pgxpool.Pool, version string) []string {
	t.Helper()
	st, err := m.Status(context.Background())
	require.NoError(t, err)
	var newer []string
	for _, r := range st {
		if r.Applied && r.Version > version {
			newer = append(newer, r.Version)
		}
	}
	if len(newer) == 0 {
		return nil
	}
	rolled, err := m.Down(context.Background(), len(newer))
	require.NoError(t, err)
	require.Len(t, rolled, len(newer))
	return rolled
}

func seedMigUserWS(t *testing.T, pool *pgxpool.Pool, tag string) (userID, wsID string) {
	t.Helper()
	ctx := context.Background()
	uid := uuid.NewString()
	email := fmt.Sprintf("%s-%s@test.dev", tag, uid[:8])
	_, err := pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`, uid, email)
	require.NoError(t, err)
	wsID = uuid.NewString()
	_, err = pool.Exec(ctx,
		`INSERT INTO workspace (id, slug, name, plan_code, created_by) VALUES ($1, $2, $3, 'free', $4)`,
		wsID, tag+"-"+wsID[:12], "迁移门测试", uid)
	require.NoError(t, err)
	t.Cleanup(func() {
		cctx := context.Background()
		_, _ = pool.Exec(cctx, `DELETE FROM workspace WHERE id = $1`, wsID)
		_, _ = pool.Exec(cctx, `DELETE FROM "user" WHERE id = $1`, uid)
	})
	return uid, wsID
}

func TestWorkspacePlanFK_UpDownUp(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	fkExists := func() bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_plan_code_fkey')`).Scan(&exists))
		return exists
	}
	assert.True(t, fkExists(), "全量 up 后应存在 workspace_plan_code_fkey")

	applied, err := m.Up(ctx, 0)
	require.NoError(t, err)
	assert.Empty(t, applied)

	rolled := rollbackAbove(t, m, pool, "024")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "025", rolled[len(rolled)-1], "最低回滚点必须是 025")
	assert.False(t, fkExists())

	_, wsID := seedMigUserWS(t, pool, "fk25")
	_, err = pool.Exec(ctx, `UPDATE workspace SET plan_code = 'ghost_plan' WHERE id = $1`, wsID)
	require.NoError(t, err, "无约束窗口应允许目录外 plan_code 落库")

	_, err = m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, fkExists(), "down 后再 up 应重建约束")
	var plan string
	require.NoError(t, pool.QueryRow(ctx, `SELECT plan_code FROM workspace WHERE id = $1`, wsID).Scan(&plan))
	assert.Equal(t, "free", plan, "目录外 plan_code 应被清洗为 free")
}

func TestWorkspaceRoleConfig_UpDownUp(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	tableExists := func(name string) bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = $1)`, name).Scan(&exists))
		return exists
	}

	assert.True(t, tableExists("workspace_role"), "026 up 后应存在集合式配置表 workspace_role")
	assert.False(t, tableExists("workspace_role_permission"), "026 up 应 DROP 行级旧表（WA2 决策：旧数据不要）")

	_, wsID := seedMigUserWS(t, pool, "az26")
	_, err := pool.Exec(ctx,
		`INSERT INTO workspace_role (workspace_id, role, perms) VALUES ($1, 'member', '[]'::jsonb)`, wsID)
	require.NoError(t, err, "空数组配置行（显式清零）应可写入")

	rolled := rollbackAbove(t, m, pool, "025")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "026", rolled[len(rolled)-1], "最低回滚点必须是 026（回滚清单随更高版本自动扩展）")
	assert.False(t, tableExists("workspace_role"))
	assert.True(t, tableExists("workspace_role_permission"), "down 应重建行级表")

	_, err = pool.Exec(ctx,
		`INSERT INTO workspace_role_permission (workspace_id, role, permission) VALUES ($1, 'member', 'tasks:read')`, wsID)
	require.NoError(t, err)
	_, err = m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, tableExists("workspace_role"))
	assert.False(t, tableExists("workspace_role_permission"))
}

func TestMemberRemovedBy_UpDownUp(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	colExists := func() bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name = 'member' AND column_name = 'removed_by')`).Scan(&exists))
		return exists
	}

	assert.True(t, colExists(), "028 up 后 member 应有 removed_by 列")

	uid, wsID := seedMigUserWS(t, pool, "rb28")
	removed := uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`,
		removed, fmt.Sprintf("rb28r-%s@test.dev", removed[:8]))
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, removed) })
	_, err = pool.Exec(ctx,
		`INSERT INTO member (workspace_id, user_id, role, created_by, removed_at, removed_by)
		 VALUES ($1, $2, 'member', $3, now(), $4)`, wsID, removed, uid, uid)
	require.NoError(t, err, "removed_by 应可写且接受合法 user id（FK 生效）")
	_, err = pool.Exec(ctx,
		`INSERT INTO member (workspace_id, user_id, role, created_by, removed_at, removed_by)
		 VALUES ($1, $2, 'member', $3, now(), $4)`, wsID, uid, uid, uuid.NewString())
	assert.Error(t, err, "removed_by 指向不存在的 user 应被 FK 拒绝")

	rolled := rollbackAbove(t, m, pool, "027")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "028", rolled[len(rolled)-1], "最低回滚点必须是 028（回滚清单随更高版本自动扩展）")
	assert.False(t, colExists())

	_, err = m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, colExists())
}

func TestQuotaGrantFullUnique_UpDownUp(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	indexPartial := func() bool {
		var def string
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_quota_grant_dedup'`).Scan(&def))
		return strings.Contains(def, "WHERE")
	}

	_, wsID := seedMigUserWS(t, pool, "qg29")
	insert := func(ref any) error {
		_, err := pool.Exec(ctx, `
			INSERT INTO quota_grant (workspace_id, period, counter_key, amount, reason, ref_id)
			VALUES ($1, '2026-10', 'tasks_monthly', 10, 'milestone', $2)`, wsID, ref)
		return err
	}

	assert.False(t, indexPartial(), "029 后应为全量唯一索引（部分索引是 AD2 缺陷现场）")

	require.NoError(t, insert("r-1"))
	assert.Error(t, insert("r-1"), "同四元组第二行必须被唯一索引拒绝")
	require.NoError(t, insert(""))
	assert.Error(t, insert(""), "空串 ref 是值（非 NULL）：同空串四元组同样唯一")

	rolled := rollbackAbove(t, m, pool, "028")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "029", rolled[len(rolled)-1])
	assert.True(t, indexPartial(), "down 应恢复 006 的部分唯一索引")
	require.NoError(t, insert(nil), "down 后 NULL ref 行可落库（列可空、部分索引不覆盖）")

	_, err := m.Up(ctx, 0)
	require.NoError(t, err)
	assert.False(t, indexPartial())
	var n int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM quota_grant WHERE workspace_id = $1 AND ref_id IS NULL`, wsID).Scan(&n))
	assert.Zero(t, n, "029 up 应清除 NULL ref 旧行")
}

func TestAuditQueryIndexes_UpDownUp(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	idxExists := func(name string) bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = $1)`, name).Scan(&exists))
		return exists
	}

	assert.True(t, idxExists("idx_audit_created"), "全局列表（ORDER BY created_at DESC）支撑索引")
	assert.True(t, idxExists("idx_audit_actor_time"), "actor 过滤/邮箱搜索支撑索引")

	rolled := rollbackAbove(t, m, pool, "029")
	require.Equal(t, "030", rolled[len(rolled)-1], "最低回滚点必须是 030（回滚清单随更高版本自动扩展；033 起已有更高版本）")
	require.Contains(t, rolled, "033")
	assert.False(t, idxExists("idx_audit_created"))
	assert.False(t, idxExists("idx_audit_actor_time"))

	_, err := m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, idxExists("idx_audit_created"))
	assert.True(t, idxExists("idx_audit_actor_time"))

	conn, err := pool.Acquire(ctx)
	require.NoError(t, err)
	defer func() {
		_, _ = conn.Exec(context.Background(), `SET enable_seqscan = on`)
		conn.Release()
	}()
	_, err = conn.Exec(ctx, `SET enable_seqscan = off`)
	require.NoError(t, err)
	explainAll := func(sql string, args ...any) string {
		rows, err := conn.Query(ctx, "EXPLAIN (COSTS OFF) "+sql, args...)
		require.NoError(t, err)
		defer rows.Close()
		var b strings.Builder
		for rows.Next() {
			var line string
			require.NoError(t, rows.Scan(&line))
			b.WriteString(line + "\n")
		}
		require.NoError(t, rows.Err())
		return b.String()
	}
	plan1 := explainAll(`SELECT id FROM audit_event ORDER BY created_at DESC LIMIT 100`)
	assert.Contains(t, plan1, "Index Scan", "全局列表（管理台默认视图）应可走 created_at 索引")
	assert.NotContains(t, plan1, "Seq Scan", "关 seqscan 后全局列表不应退化全表扫")
	plan2 := explainAll(
		`SELECT id FROM audit_event WHERE actor_id = $1 ORDER BY created_at DESC LIMIT 100`, "u-x")
	assert.Contains(t, plan2, "Index Scan", "actor 过滤/邮箱搜索应可走 (actor_id, created_at) 索引")
	assert.Contains(t, plan2, "actor_id", "计划节点应落在 actor_id 分区本地索引上")
	assert.NotContains(t, plan2, "Seq Scan")
}

func TestNotificationMonthDedup_UpDownUp(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	idxExists := func() bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_notification_month')`).Scan(&exists))
		return exists
	}
	colExists := func() bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name = 'notification' AND column_name = 'once_per_month')`).Scan(&exists))
		return exists
	}

	assert.True(t, idxExists(), "033 up 后应存在当月一次唯一索引")
	assert.True(t, colExists())

	uid, _ := seedMigUserWS(t, pool, "nm33")
	insertOnce := func(typ, created string) error {
		_, err := pool.Exec(ctx, `
			INSERT INTO notification (user_id, type, title, once_per_month, created_at)
			VALUES ($1, $2, 't', true, $3::timestamptz)`, uid, typ, created)
		return err
	}
	insertOther := func(typ, dedup, created string) error {
		_, err := pool.Exec(ctx, `
			INSERT INTO notification (user_id, type, title, dedup_key, created_at)
			VALUES ($1, $2, 't', NULLIF($3, ''), $4::timestamptz)`, uid, typ, dedup, created)
		return err
	}

	require.NoError(t, insertOnce("quota_near_limit", "2026-10-07T10:00:00Z"))
	assert.Error(t, insertOnce("quota_near_limit", "2026-10-31T23:00:00Z"),
		"同自然月第二行月度行必须被唯一索引拒绝")
	require.NoError(t, insertOnce("quota_near_limit", "2026-11-01T00:30:00Z"), "跨月放行")

	require.NoError(t, insertOnce("quota_exhausted", "2026-10-20T10:00:00Z"))

	require.NoError(t, insertOther("quota_near_limit", "k:ws1:2026-10", "2026-10-07T11:00:00Z"))
	require.NoError(t, insertOther("quota_near_limit", "k:ws2:2026-10", "2026-10-07T12:00:00Z"))

	require.NoError(t, insertOther("task_reminder", "", "2026-10-07T13:00:00Z"))
	require.NoError(t, insertOther("task_reminder", "", "2026-10-08T13:00:00Z"))

	rolled := rollbackAbove(t, m, pool, "032")
	require.Contains(t, rolled, "033")
	assert.False(t, idxExists())
	assert.False(t, colExists())
	_, err := pool.Exec(ctx, `
		INSERT INTO notification (user_id, type, title, created_at)
		VALUES ($1, 'quota_near_limit', 't', '2026-10-09T10:00:00Z')`, uid)
	require.NoError(t, err, "down 后同月同类型可多条（月度约束随索引消失）")

	_, err = m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, idxExists())
	assert.True(t, colExists())
}

func TestWebhookPendingUniqueAndRotation_UpDownUp(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	indexDef := func() string {
		var def string
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_webhook_delivery'`).Scan(&def))
		return def
	}
	subColExists := func(col string) bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name = 'webhook_subscription' AND column_name = $1)`, col).Scan(&exists))
		return exists
	}

	_, wsID := seedMigUserWS(t, pool, "wh31")
	var subID string
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO webhook_subscription (workspace_id, event_types, url, secret)
		VALUES ($1, '["task.created"]'::jsonb, 'https://e.test/hook', 'sealed:v1:x')
		RETURNING id`, wsID).Scan(&subID))
	insertDelivery := func(status string) error {
		_, err := pool.Exec(ctx, `
			INSERT INTO webhook_delivery (subscription_id, workspace_id, event_id, event_type, payload, status)
			VALUES ($1, $2, 'evt-gate-31', 'task.created', '{}'::jsonb, $3)`, subID, wsID, status)
		return err
	}

	assert.Contains(t, indexDef(), "WHERE", "031 后应为部分唯一索引（pending 唯一，WH12）")
	require.NoError(t, insertDelivery("pending"))
	assert.Error(t, insertDelivery("pending"), "同 (sub,event) 两条 pending 必须被部分唯一索引拒绝")
	require.NoError(t, insertDelivery("delivered"), "delivered 与 pending 同 event_id 共存合法（合法重发语义）")

	for _, col := range []string{"old_secret", "old_secret_expires_at", "first_failure_at"} {
		assert.True(t, subColExists(col), "032 后 webhook_subscription 应有 %s 列", col)
	}

	rolled := rollbackAbove(t, m, pool, "030")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "031", rolled[len(rolled)-1], "最低回滚点必须是 031（回滚清单随更高版本自动扩展）")
	assert.Contains(t, rolled, "032")
	assert.NotContains(t, indexDef(), "WHERE", "down 后应恢复全量唯一索引")
	for _, col := range []string{"old_secret", "old_secret_expires_at", "first_failure_at"} {
		assert.False(t, subColExists(col), "down 后 %s 列应消失", col)
	}
	var n int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM webhook_delivery WHERE subscription_id = $1`, subID).Scan(&n))
	assert.Equal(t, 1, n, "down 的 dedupe 应把同 event_id 双行收敛为最新一行")

	_, err := m.Up(ctx, 0)
	require.NoError(t, err)
	assert.Contains(t, indexDef(), "WHERE")
	for _, col := range []string{"old_secret", "old_secret_expires_at", "first_failure_at"} {
		assert.True(t, subColExists(col))
	}
	require.NoError(t, insertDelivery("pending"), "再 up 后合法重发语义恢复（第二条 pending 与收敛留存的 delivered 共存）")
}

func TestSessionImpersonatedBy_UpDownUp(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	colExists := func() bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name = 'session' AND column_name = 'impersonated_by')`).Scan(&exists))
		return exists
	}

	assert.True(t, colExists(), "034 up 后 session 应有 impersonated_by 列")

	uid, _ := seedMigUserWS(t, pool, "ib34")
	admin := uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`,
		admin, fmt.Sprintf("ib34a-%s@test.dev", admin[:8]))
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM session WHERE user_id = $1`, uid) })
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, admin) })

	_, err = pool.Exec(ctx,
		`INSERT INTO session (user_id, token_hash, expires_at, absolute_expires_at, impersonated_by)
		 VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day', $3)`,
		uid, "mig034-token-hash", admin)
	require.NoError(t, err, "impersonated_by 应可写且接受合法 user id（FK 生效）")
	_, err = pool.Exec(ctx,
		`INSERT INTO session (user_id, token_hash, expires_at, absolute_expires_at, impersonated_by)
		 VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day', $3)`,
		uid, "mig034-token-hash-2", uuid.NewString())
	assert.Error(t, err, "impersonated_by 指向不存在的 user 应被 FK 拒绝")

	rolled := rollbackAbove(t, m, pool, "033")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "034", rolled[len(rolled)-1], "最低回滚点必须是 034（回滚清单随更高版本自动扩展）")
	assert.False(t, colExists())

	_, err = m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, colExists(), "down 后再 up 幂等重建列")
}

func relkindOf(t *testing.T, pool *pgxpool.Pool, table string) string {
	t.Helper()
	var kind string
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT relkind FROM pg_class WHERE relname = $1`, table).Scan(&kind))
	return kind
}

func pkColumnsOf(t *testing.T, pool *pgxpool.Pool, table string) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT a.attname
		FROM pg_index i
		JOIN pg_class c ON c.oid = i.indrelid
		JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
		JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
		WHERE c.relname = $1 AND i.indisprimary
		ORDER BY k.ord`, table)
	require.NoError(t, err)
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var c string
		require.NoError(t, rows.Scan(&c))
		cols = append(cols, c)
	}
	require.NoError(t, rows.Err())
	return cols
}

func attachedPartitions(t *testing.T, pool *pgxpool.Pool, parent string) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT c.relname FROM pg_inherits i
		JOIN pg_class c ON c.oid = i.inhrelid
		WHERE i.inhparent = $1::regclass
		ORDER BY c.relname`, parent)
	require.NoError(t, err)
	defer rows.Close()
	var names []string
	for rows.Next() {
		var n string
		require.NoError(t, rows.Scan(&n))
		names = append(names, n)
	}
	require.NoError(t, rows.Err())
	return names
}

func hasDefaultPartition(t *testing.T, pool *pgxpool.Pool, parent string) bool {
	t.Helper()
	var yes bool
	require.NoError(t, pool.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1 FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
			WHERE i.inhparent = $1::regclass
			  AND pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT')`, parent).Scan(&yes))
	return yes
}

func dropPartitionQuiet(t *testing.T, pool *pgxpool.Pool, parent, name string) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		fmt.Sprintf(`ALTER TABLE %s DETACH PARTITION %s`, parent, name))
	require.NoError(t, err, "清理：DETACH 测试分区 %s", name)
	_, err = pool.Exec(context.Background(), fmt.Sprintf(`DROP TABLE %s`, name))
	require.NoError(t, err, "清理：DROP 测试分区 %s", name)
}

func TestAuditEventPartition_UpDownUp(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	countAudit := func() int {
		var n int
		require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM audit_event`).Scan(&n))
		return n
	}

	assert.Equal(t, "p", relkindOf(t, pool, "audit_event"), "035 up 后应为分区母表")
	assert.Equal(t, []string{"id", "created_at"}, pkColumnsOf(t, pool, "audit_event"),
		"分区键必须进 PK（PG 唯一约束要求）")
	assert.False(t, hasDefaultPartition(t, pool, "audit_event"), "不得设 default 分区（ADR 0009 裁决）")

	now := time.Now().UTC()
	base := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	parts := attachedPartitions(t, pool, "audit_event")
	for i := 0; i <= 2; i++ {
		assert.Contains(t, parts, fmt.Sprintf("audit_event_%s", base.AddDate(0, i, 0).Format("2006_01")),
			"应预建当前月+未来 2 月分区（worker 义务同款）")
	}

	preParts := append([]string(nil), parts...)

	rolled := rollbackAbove(t, m, pool, "034")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "035", rolled[len(rolled)-1], "最低回滚点必须是 035")
	assert.Contains(t, rolled, "036", "036 应先于 035 回滚（高→低）")
	assert.Equal(t, "r", relkindOf(t, pool, "audit_event"))
	assert.Equal(t, []string{"id"}, pkColumnsOf(t, pool, "audit_event"))
	assert.Empty(t, attachedPartitions(t, pool, "audit_event"))

	oldMonth := base.AddDate(0, -13, 0)
	seedAudit := func(id string, at time.Time) {
		_, err := pool.Exec(ctx, `
			INSERT INTO audit_event (id, actor_type, action, resource_type, created_at)
			VALUES ($1, 'system', 'mig035.seed', 'test', $2)`, id, at)
		require.NoError(t, err)
	}
	id1, id2, id3 := uuid.NewString(), uuid.NewString(), uuid.NewString()
	seedAudit(id1, oldMonth.Add(24*time.Hour))
	seedAudit(id2, oldMonth.Add(48*time.Hour))
	seedAudit(id3, now)
	before := countAudit()

	_, err := m.Up(ctx, 0)
	require.NoError(t, err)
	assert.Equal(t, before, countAudit(), "重建迁移必须行数守恒（INSERT SELECT 全量）")
	assert.Equal(t, "p", relkindOf(t, pool, "audit_event"))
	assert.Contains(t, attachedPartitions(t, pool, "audit_event"),
		fmt.Sprintf("audit_event_%s", oldMonth.Format("2006_01")),
		"存量最早月应有对应分区（否则灌数据即失败，此断言是冗余保险）")

	_, err = pool.Exec(ctx, `
		INSERT INTO audit_event (id, actor_type, action, resource_type, created_at)
		VALUES ($1, 'system', 'mig035.dup', 'test', $2)`, id3, now)
	assert.Error(t, err, "同 (id, created_at) 必须仍被 PK 拒绝")
	seedAudit(id3, oldMonth.Add(72*time.Hour))

	_, err = pool.Exec(ctx, `DELETE FROM audit_event WHERE id IN ($1, $2, $3)`, id1, id2, id3)
	require.NoError(t, err)
	keep := map[string]bool{}
	for _, n := range preParts {
		keep[n] = true
	}
	for _, n := range attachedPartitions(t, pool, "audit_event") {
		if !keep[n] {
			dropPartitionQuiet(t, pool, "audit_event", n)
		}
	}
}

func TestAnalyticsEventPartition_UpDownUp(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	countAn := func() int {
		var n int
		require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM analytics_event`).Scan(&n))
		return n
	}

	assert.Equal(t, "p", relkindOf(t, pool, "analytics_event"))
	assert.Equal(t, []string{"id", "created_at"}, pkColumnsOf(t, pool, "analytics_event"))
	assert.False(t, hasDefaultPartition(t, pool, "analytics_event"))

	preParts := append([]string(nil), attachedPartitions(t, pool, "analytics_event")...)

	rolled := rollbackAbove(t, m, pool, "035")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "036", rolled[len(rolled)-1], "最低回滚点必须是 036")
	assert.Equal(t, "r", relkindOf(t, pool, "analytics_event"))
	assert.Equal(t, []string{"id"}, pkColumnsOf(t, pool, "analytics_event"))

	oldMonth := time.Now().UTC()
	oldMonth = time.Date(oldMonth.Year(), oldMonth.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -13, 0)
	seedAn := func(id int64, at time.Time) {
		_, err := pool.Exec(ctx, `
			INSERT INTO analytics_event (id, event_type, created_at)
			OVERRIDING SYSTEM VALUE VALUES ($1, 'an_mig036', $2)`, id, at)
		require.NoError(t, err)
	}
	const hiID = int64(9_000_000_003)
	seedAn(hiID-2, oldMonth.Add(24*time.Hour))
	seedAn(hiID-1, oldMonth.Add(48*time.Hour))
	seedAn(hiID, time.Now().UTC())
	before := countAn()

	_, err := m.Up(ctx, 0)
	require.NoError(t, err)
	assert.Equal(t, before, countAn(), "重建迁移必须行数守恒")
	assert.Equal(t, "p", relkindOf(t, pool, "analytics_event"))
	assert.Contains(t, attachedPartitions(t, pool, "analytics_event"),
		fmt.Sprintf("analytics_event_%s", oldMonth.Format("2006_01")))

	var newID int64
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO analytics_event (event_type, created_at) VALUES ('an_mig036_seq', now()) RETURNING id`).Scan(&newID))
	assert.Greater(t, newID, hiID, "identity 序列应被 setval 到 max(id)+1，新插入不得回卷")

	_, err = pool.Exec(ctx, `DELETE FROM analytics_event WHERE id >= $1 OR event_type LIKE 'an_mig036%'`, hiID-2)
	require.NoError(t, err)
	keep := map[string]bool{}
	for _, n := range preParts {
		keep[n] = true
	}
	for _, n := range attachedPartitions(t, pool, "analytics_event") {
		if !keep[n] {
			dropPartitionQuiet(t, pool, "analytics_event", n)
		}
	}
}

func TestSchedulePlanUpDownUp(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	tableExists := func() bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schedule_plan')`).Scan(&exists))
		return exists
	}

	assert.True(t, tableExists(), "037 up 后 schedule_plan 应存在")

	_, wsID := seedMigUserWS(t, pool, "sch37")
	_, err := pool.Exec(ctx, `
		INSERT INTO schedule_plan (workspace_id, kind, cron_expr, timezone, next_fire_at)
		VALUES ($1, 'test.kind', '0 9 * * *', 'UTC', now() + interval '1 hour')`, wsID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO schedule_plan (workspace_id, kind, cron_expr, timezone, next_fire_at, misfire)
		VALUES ($1, 'test.kind', '0 9 * * *', 'UTC', now() + interval '1 hour', 'always')`, wsID)
	assert.Error(t, err, "misfire 非法值应被 CHECK 拒绝（仅 skip/once 两档）")

	rolled := rollbackAbove(t, m, pool, "036")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "037", rolled[len(rolled)-1], "最低回滚点必须是 037")
	assert.False(t, tableExists())

	_, err = m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, tableExists(), "down 后再 up 幂等重建")
}

func TestSiteSettingsUpDownUp(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	tableExists := func() bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'site_settings')`).Scan(&exists))
		return exists
	}

	assert.True(t, tableExists(), "038 up 后 site_settings 应存在")

	_, err := pool.Exec(ctx,
		`INSERT INTO site_settings (key, value, updated_by) VALUES ('mig038_probe', '1', 'migration-test')`)
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM site_settings WHERE key = 'mig038_probe'`) })

	rolled := rollbackAbove(t, m, pool, "037")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "038", rolled[len(rolled)-1], "最低回滚点必须是 038")
	assert.False(t, tableExists())

	_, err = m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, tableExists(), "down 后再 up 幂等重建")
}

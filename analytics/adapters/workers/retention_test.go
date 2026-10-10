package workers

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/platform/pgpart"
)

func TestRetentionWorker_RoundNoopOnFreshPartitions(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	t.Cleanup(db.Close)
	require.NoError(t, pgmigrate.Up(ctx, db.Pool(), migrations.FS, "."))
	pool := db.Pool()

	w := &RetentionWorker{Table: &pgpart.Table{Pool: pool, Parent: "analytics_event"}}
	assert.Equal(t, "analytics_retention", w.Name())

	require.NoError(t, w.round(ctx, time.Now().UTC()))

	now := time.Now().UTC()
	base := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i <= 2; i++ {
		name := "analytics_event_" + base.AddDate(0, i, 0).Format("2006_01")
		var attached bool
		require.NoError(t, pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM pg_inherits i
			JOIN pg_class c ON c.oid = i.inhrelid
			WHERE i.inhparent = 'analytics_event'::regclass AND c.relname = $1)`, name).Scan(&attached))
		assert.True(t, attached, "分区 %s 应在位（无 default 分区，断档即写入失败）", name)
	}
}

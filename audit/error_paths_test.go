package audit

import (
	"bytes"
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func unreachableRecorder(t *testing.T) *Recorder {
	t.Helper()
	pool, err := pgxpool.New(context.Background(),
		"postgres://nouser@127.0.0.1:1/nowhere?sslmode=disable&connect_timeout=2")
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return NewRecorder(pool, nil)
}

func TestQuery_DBErrorPropagates_P3_28(t *testing.T) {
	r := unreachableRecorder(t)
	items, total, err := r.Query(context.Background(), ListQuery{WorkspaceID: "ws"})
	require.Error(t, err, "DB 故障必须上抛（修复前无错误路径覆盖）")
	assert.Zero(t, total)
	assert.Nil(t, items)
}

func TestExportCSV_DBErrorPropagates_P3_28(t *testing.T) {
	r := unreachableRecorder(t)
	var buf bytes.Buffer
	err := r.ExportCSV(context.Background(), ListQuery{}, &buf)
	require.Error(t, err)
	assert.Zero(t, buf.Len(), "失败导出不得产出半截内容")
}

func TestRecord_SurvivesCallerCancel_P3_26(t *testing.T) {
	r := unreachableRecorder(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	assert.NotPanics(t, func() {
		r.Record(ctx, nil, &webx.Principal{UserID: "u1"}, "action", "order", "o1", nil)
	}, "WithoutCancel：取消的 ctx 不得让审计写入路径 panic 或短路报错")
}

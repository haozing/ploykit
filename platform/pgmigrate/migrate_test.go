package pgm

import (
	"context"
	"embed"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

//go:embed testdata
var testFS embed.FS

func TestVersionLessNumeric(t *testing.T) {
	assert.True(t, versionLess("999", "1001"), "数值序 999<1001（词典序恰反，本行是修复锚）")
	assert.True(t, versionLess("0999", "1001"), "审计锚：0999<1001")
	assert.False(t, versionLess("1001", "0999"))
	assert.True(t, versionLess("042", "999"))
	assert.True(t, versionLess("999", "1000"))

	assert.True(t, versionLess("0999", "999"), "等值 tiebreak：0999 先于 999")
	assert.False(t, versionLess("999", "0999"))
	assert.False(t, versionLess("999", "999"))

	assert.True(t, versionLess("abc", "001"))
}

func TestScanSortsNumerically(t *testing.T) {
	m := New(nil, testFS, "testdata")
	_, _, versions, err := m.scan()
	require.NoError(t, err)
	assert.Equal(t, []string{"002", "500", "999", "1001"}, versions)
}

func TestScanDuplicateDownRejected(t *testing.T) {
	m := New(nil, testFS, "testdata/dupdown")
	_, _, _, err := m.scan()
	require.Error(t, err)
	assert.Contains(t, err.Error(), `duplicate down version "002"`)
}

func TestDownRejectsZeroLimit(t *testing.T) {
	m := New(nil, embed.FS{}, ".")
	_, err := m.Down(context.Background(), 0)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "拒绝执行")
	assert.Contains(t, err.Error(), "负数", "错误信息必须指明全量回滚的 opt-in 路径")
}

func TestHasNoTxMarker(t *testing.T) {
	cases := []struct {
		name string
		data string
		want bool
	}{
		{"规范形", "-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY i ON t(c);", true},
		{"BOM 前缀", "\uFEFF-- migrate:no-transaction\nCREATE INDEX i ON t(c);", true},
		{"大小写变体", "-- MIGRATE:NO-TRANSACTION\nSELECT 1;", true},
		{"BOM+空白+大小写", "\uFEFF\n  -- Migrate:No-Transaction\nSELECT 1;", true},
		{"标记不在开头", "SELECT 1;\n-- migrate:no-transaction", false},
		{"普通注释", "-- migrate:transaction\nSELECT 1;", false},
		{"普通 DDL", "CREATE TABLE t(id int);", false},
		{"空", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, hasNoTxMarker(c.data))
		})
	}
}

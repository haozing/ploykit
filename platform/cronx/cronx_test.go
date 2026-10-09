package cronx

import (
	"testing"
	"time"
	_ "time/tzdata"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func utc(year int, m time.Month, d, h, min int) time.Time {
	return time.Date(year, m, d, h, min, 0, 0, time.UTC)
}

func TestNextBasics(t *testing.T) {
	t.Run("基础五字段", func(t *testing.T) {

		got, err := Next("30 2 * * *", "", utc(2026, 3, 10, 0, 0))
		require.NoError(t, err)
		assert.Equal(t, utc(2026, 3, 10, 2, 30), got)
	})

	t.Run("空 tz → UTC 且返回时刻 Location=UTC", func(t *testing.T) {
		got, err := Next("0 12 * * *", "", utc(2026, 1, 1, 0, 0))
		require.NoError(t, err)
		assert.Equal(t, time.UTC, got.Location())
		assert.Equal(t, utc(2026, 1, 1, 12, 0), got)
	})

	t.Run("严格晚于 after（after 恰在触发点 → 取下一个）", func(t *testing.T) {
		after := utc(2026, 3, 10, 2, 30)
		got, err := Next("30 2 * * *", "", after)
		require.NoError(t, err)
		assert.True(t, got.After(after), "返回时刻必须严格晚于 after")
		assert.Equal(t, utc(2026, 3, 11, 2, 30), got)
	})

	t.Run("亚秒输入对齐到整分", func(t *testing.T) {
		after := time.Date(2026, 3, 10, 2, 29, 59, 999999999, time.UTC)
		got, err := Next("30 2 * * *", "", after)
		require.NoError(t, err)
		assert.Equal(t, utc(2026, 3, 10, 2, 30), got)
		assert.Zero(t, got.Nanosecond())
	})

	t.Run("after 换算到 tz 后求值", func(t *testing.T) {

		got, err := Next("0 16 * * *", "Asia/Shanghai", utc(2026, 6, 1, 0, 0))
		require.NoError(t, err)
		assert.True(t, got.Equal(utc(2026, 6, 1, 8, 0)), "上海 16:00 == UTC 08:00")
		sh, err := time.LoadLocation("Asia/Shanghai")
		require.NoError(t, err)
		assert.Equal(t, sh, got.Location(), "返回时刻携带 tz 的 Location")
	})

	t.Run("周字段", func(t *testing.T) {

		got, err := Next("0 9 * * 1", "", utc(2026, 3, 10, 12, 0))
		require.NoError(t, err)
		assert.Equal(t, utc(2026, 3, 16, 9, 0), got)
		assert.Equal(t, time.Monday, got.Weekday())
	})
}

func TestNextErrors(t *testing.T) {
	t.Run("坏表达式", func(t *testing.T) {
		_, err := Next("99 * * * *", "", time.Now())
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "bad cron")
	})
	t.Run("六字段（含秒）不是本契约语法", func(t *testing.T) {
		_, err := Next("0 30 2 * * *", "", time.Now())
		assert.Error(t, err)
	})
	t.Run("坏时区", func(t *testing.T) {
		_, err := Next("30 2 * * *", "Mars/Olympus", time.Now())
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "bad timezone")
	})
	t.Run(`时区 "Local" 被拒绝（P2-22）`, func(t *testing.T) {
		_, err := Next("30 2 * * *", "Local", time.Now())
		require.Error(t, err)
		assert.Contains(t, err.Error(), "rejected")
		assert.NotContains(t, err.Error(), "bad timezone", "拒绝理由是部署机漂移，不是加载失败")
	})
	t.Run("UTC 显式可接受", func(t *testing.T) {
		_, err := Next("30 2 * * *", "UTC", time.Now())
		assert.NoError(t, err)
	})
}

func TestNextDST(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	require.NoError(t, err)

	t.Run("spring-forward 缺口日整日跳过", func(t *testing.T) {

		got, err := Next("30 2 * * *", "America/New_York", utc(2026, 3, 8, 5, 0))
		require.NoError(t, err)

		assert.True(t, got.Equal(utc(2026, 3, 9, 6, 30)), "got %s", got)
		want := time.Date(2026, 3, 9, 2, 30, 0, 0, ny)
		assert.True(t, got.Equal(want), "墙钟应为次日 02:30，got %s", got.In(ny))
	})

	t.Run("fall-back 同墙钟双触发", func(t *testing.T) {

		first, err := Next("30 1 * * *", "America/New_York", utc(2026, 11, 1, 5, 0))
		require.NoError(t, err)
		assert.True(t, first.Equal(utc(2026, 11, 1, 5, 30)), "第一次 01:30 EDT（UTC-4），got %s", first)

		second, err := Next("30 1 * * *", "America/New_York", first)
		require.NoError(t, err)
		assert.True(t, second.Equal(utc(2026, 11, 1, 6, 30)), "回拨后 01:30 EST（UTC-5）再次触发，got %s", second)
		assert.Equal(t, first.In(ny).Format("15:04"), second.In(ny).Format("15:04"),
			"两次触发墙钟同为 01:30（双触发实证）")

		third, err := Next("30 1 * * *", "America/New_York", second)
		require.NoError(t, err)
		assert.True(t, third.Equal(utc(2026, 11, 2, 6, 30)), "got %s", third)
	})
}

func TestNextDSTGapNoShiftForward(t *testing.T) {
	got, err := Next("30 2 * * *", "America/New_York", utc(2026, 3, 8, 5, 0))
	require.NoError(t, err)
	ny, _ := time.LoadLocation("America/New_York")
	assert.Equal(t, "02:30", got.In(ny).Format("15:04"), "跳日取同墙钟时刻，不是顺移一小时")
	assert.Equal(t, 9, got.In(ny).Day(), "缺口日（8 日）整日跳过")
}

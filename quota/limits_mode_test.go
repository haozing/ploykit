package quota

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsQuotaDimKey_ExcludesLimitMode(t *testing.T) {
	assert.False(t, isQuotaDimKey("limit_mode"),
		"limit_mode 是档位配置键，不是配额维度")
	assert.Equal(t, Limits{"tasks_monthly": int64(50)},
		quotaDims(Limits{"limit_mode": 1, "tasks_monthly": 50}))
}

func TestParseLimits_LimitMode(t *testing.T) {

	l, mode, err := parseLimits([]byte(`{"tasks_monthly":50,"limit_mode":"soft"}`))
	require.NoError(t, err)
	assert.Equal(t, LimitModeSoft, mode)
	assert.Equal(t, Limits{"tasks_monthly": 50}, l)

	_, mode, err = parseLimits([]byte(`{"limit_mode":"hard"}`))
	require.NoError(t, err)
	assert.Equal(t, LimitModeHard, mode)

	for _, raw := range []string{`{"tasks_monthly":50}`, `{}`, `null`} {
		_, mode, err = parseLimits([]byte(raw))
		require.NoError(t, err, raw)
		assert.Equal(t, LimitModeHard, mode, "缺省必须是 hard（%s）", raw)
	}

	for _, raw := range []string{
		`{"limit_mode":"sft"}`, `{"limit_mode":"SOFT"}`,
		`{"limit_mode":1}`, `{"limit_mode":null}`, `{"limit_mode":["soft"]}`,
	} {
		_, mode, err = parseLimits([]byte(raw))
		require.NoError(t, err, raw)
		assert.Equal(t, LimitModeHard, mode, "非法值必须收敛 hard（%s）", raw)
	}

	_, _, err = parseLimits([]byte(`{"tasks_monthly":"50"}`))
	assert.Error(t, err, "维度键的值必须是整数")

	l, mode, err = parseLimits([]byte(
		`{"tasks_monthly":50,"trial_days":"14","price_monthly_cents":9900,"metered_x_included":3}`))
	require.NoError(t, err)
	assert.Equal(t, LimitModeHard, mode)
	assert.Equal(t, Limits{"tasks_monthly": 50}, l)
}

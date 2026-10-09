package app_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/admin/app"
)

type fakeAnalyticsEvents struct {
	got struct {
		eventType string
		limit     int
	}
	rows []app.AnalyticsEventRow
	err  error
}

func (f *fakeAnalyticsEvents) Recent(_ context.Context, eventType string, limit int) ([]app.AnalyticsEventRow, error) {
	f.got.eventType, f.got.limit = eventType, limit
	return f.rows, f.err
}

func TestRecentEvents(t *testing.T) {
	t.Run("透传 type 过滤与 limit", func(t *testing.T) {
		port := &fakeAnalyticsEvents{rows: []app.AnalyticsEventRow{{ID: 1, Type: "user_registered"}}}
		svc := newWsOpsSvc(&wsRepo{}, nil).WithAnalyticsEvents(port)

		got, err := svc.RecentEvents(t.Context(), "user_registered", 50)
		require.NoError(t, err)
		require.Len(t, got, 1)
		assert.Equal(t, "user_registered", got[0].Type)
		assert.Equal(t, "user_registered", port.got.eventType)
		assert.Equal(t, 50, port.got.limit)
	})

	t.Run("type 空 = 全类型，原样透传空串", func(t *testing.T) {
		port := &fakeAnalyticsEvents{}
		svc := newWsOpsSvc(&wsRepo{}, nil).WithAnalyticsEvents(port)

		_, err := svc.RecentEvents(t.Context(), "", 20)
		require.NoError(t, err)
		assert.Empty(t, port.got.eventType, "空串语义（全类型）必须可区分于单类型过滤")
		assert.Equal(t, 20, port.got.limit)
	})

	t.Run("limit 防御性归一：<=0 或 >100 → 20（http 层已 400 显式非法值，此处兜底其他调用方）", func(t *testing.T) {
		for in, want := range map[int]int{-1: 20, 0: 20, 101: 20, 999: 20} {
			port := &fakeAnalyticsEvents{}
			svc := newWsOpsSvc(&wsRepo{}, nil).WithAnalyticsEvents(port)
			_, err := svc.RecentEvents(t.Context(), "", in)
			require.NoError(t, err)
			assert.Equal(t, want, port.got.limit, "limit=%d 应归一为 %d", in, want)
		}
	})

	t.Run("未接线 → 503 E_UNAVAILABLE", func(t *testing.T) {
		_, err := newWsOpsSvc(&wsRepo{}, nil).RecentEvents(t.Context(), "", 20)
		assert.Equal(t, 503, opStatus(t, err))
	})

	t.Run("底层错误透传", func(t *testing.T) {
		port := &fakeAnalyticsEvents{err: errors.New("db down")}
		svc := newWsOpsSvc(&wsRepo{}, nil).WithAnalyticsEvents(port)
		_, err := svc.RecentEvents(t.Context(), "", 20)
		require.ErrorIs(t, err, port.err)
	})
}

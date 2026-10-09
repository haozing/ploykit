package app_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/notify/app"
	"github.com/haozing/ploykit/platform/webx"
)

var frozen = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

type fakeRepo struct {
	app.Repo
	inserts []app.NotifyInput
}

func (f *fakeRepo) Insert(_ context.Context, n app.NotifyInput, _ time.Time) (bool, error) {
	f.inserts = append(f.inserts, n)
	return true, nil
}

type fakeGate struct {
	rows    []app.Preference
	allowed bool
	gateErr error

	allowedCalls int
	upserts      []struct {
		userID string
		typ    string
		email  *bool
		inApp  *bool
	}
}

func (g *fakeGate) List(context.Context, string) ([]app.Preference, error) {
	return g.rows, nil
}

func (g *fakeGate) EmailAllowed(ctx context.Context, userID, typ string) (bool, error) {
	return g.Allowed(ctx, userID, typ)
}

func (g *fakeGate) Upsert(_ context.Context, userID, typ string, email, inApp *bool) (app.Preference, error) {
	g.upserts = append(g.upserts, struct {
		userID string
		typ    string
		email  *bool
		inApp  *bool
	}{userID, typ, email, inApp})
	return app.Preference{NotificationType: typ, EmailEnabled: email == nil || *email, InAppEnabled: inApp == nil || *inApp, UpdatedAt: frozen}, nil
}

func (g *fakeGate) Allowed(_ context.Context, _, _ string) (bool, error) {
	g.allowedCalls++
	return g.allowed, g.gateErr
}

func newSvc(repo app.Repo, gate app.PrefGate) *app.NotifyService {
	return app.NewNotifyService(repo, nil, func() time.Time { return frozen }).WithPrefGate(gate)
}

func TestNotify_InAppGate(t *testing.T) {
	input := app.NotifyInput{UserID: "u1", Type: "quota_near_limit", Title: "配额将尽", Link: "/billing"}

	t.Run("未挂载闸门(nil)时全部放行", func(t *testing.T) {
		f := &fakeRepo{}
		svc := app.NewNotifyService(f, nil, func() time.Time { return frozen })
		require.NoError(t, svc.Notify(t.Context(), input))
		assert.Len(t, f.inserts, 1, "nil 闸门 = 框架零依赖默认，通知照常落库")
	})

	t.Run("闸门关闭时静默跳过不落库", func(t *testing.T) {
		f := &fakeRepo{}
		svc := newSvc(f, &fakeGate{allowed: false})
		require.NoError(t, svc.Notify(t.Context(), input))
		assert.Empty(t, f.inserts)
	})

	t.Run("无 Link 通知同样过闸门", func(t *testing.T) {
		f := &fakeRepo{}
		svc := newSvc(f, &fakeGate{allowed: false})
		noLink := input
		noLink.Link = ""
		require.NoError(t, svc.Notify(t.Context(), noLink))
		assert.Empty(t, f.inserts, "Link 为空的常规通知也应被闸门拦截（合并计数路径已删除）")
	})

	t.Run("闸门故障时尽力而为放行(best-effort)", func(t *testing.T) {
		f := &fakeRepo{}
		svc := newSvc(f, &fakeGate{gateErr: errors.New("pref store down")})
		require.NoError(t, svc.Notify(t.Context(), input))
		assert.Len(t, f.inserts, 1, "闸门查询失败只记日志，不应阻断通知主链")
	})

	t.Run("NotifyOncePerMonth 同样过闸门", func(t *testing.T) {
		f := &fakeRepo{}
		svc := newSvc(f, &fakeGate{allowed: false})
		require.NoError(t, svc.NotifyOncePerMonth(t.Context(), input))
		assert.Empty(t, f.inserts, "当月去重路径也应被闸门拦截")
	})
}

func TestNotify_NoLinkKeepsTitleBody(t *testing.T) {
	f := &fakeRepo{}
	svc := app.NewNotifyService(f, nil, func() time.Time { return frozen })
	require.NoError(t, svc.Notify(t.Context(), app.NotifyInput{
		UserID: "u1", Type: "quota_near_limit", Title: "配额将尽", Body: "tasks 已用 40/50",
	}))
	require.Len(t, f.inserts, 1)
	assert.Equal(t, "配额将尽", f.inserts[0].Title)
	assert.Equal(t, "tasks 已用 40/50", f.inserts[0].Body)
}

func TestNotifyOncePerMonth_DirectInsert(t *testing.T) {
	f := &fakeRepo{}
	svc := app.NewNotifyService(f, nil, func() time.Time { return frozen })
	require.NoError(t, svc.NotifyOncePerMonth(t.Context(), app.NotifyInput{
		UserID: "u1", Type: "quota_near_limit", Title: "配额将尽", Body: "已用 40/50", Link: "/billing",
	}))
	require.Len(t, f.inserts, 1)
	assert.True(t, f.inserts[0].OncePerMonth, "月度语义行必须带 once_per_month（迁移 033 索引谓词）")
	assert.Empty(t, f.inserts[0].DedupKey, "月度语义与永久去重互斥：并置会被 DedupKey 语义吞掉跨月重发")
}

func TestPreferenceReadWrite(t *testing.T) {
	t.Run("List 未挂载闸门返回空列表", func(t *testing.T) {
		svc := app.NewNotifyService(&fakeRepo{}, nil, func() time.Time { return frozen })
		items, err := svc.ListPreferences(t.Context(), "u1")
		require.NoError(t, err)
		assert.Empty(t, items)
	})

	t.Run("List 只返回显式设置过的行(不补默认)", func(t *testing.T) {
		rows := []app.Preference{{NotificationType: "quota_near_limit", EmailEnabled: false, InAppEnabled: true, UpdatedAt: frozen}}
		svc := newSvc(&fakeRepo{}, &fakeGate{rows: rows})
		items, err := svc.ListPreferences(t.Context(), "u1")
		require.NoError(t, err)
		require.Len(t, items, 1)
		assert.Equal(t, "quota_near_limit", items[0].NotificationType)
		assert.False(t, items[0].EmailEnabled)
		assert.True(t, items[0].InAppEnabled)
	})

	t.Run("Upsert 至少一个布尔否则 E_VALIDATION", func(t *testing.T) {
		svc := newSvc(&fakeRepo{}, &fakeGate{})
		_, err := svc.UpsertPreference(t.Context(), "u1", "quota_near_limit", nil, nil)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadRequest, we.Status)
		assert.Equal(t, webx.CodeValidation, we.Code)
	})

	t.Run("Upsert type 越界拒绝", func(t *testing.T) {
		svc := newSvc(&fakeRepo{}, &fakeGate{})
		no := false
		for _, typ := range []string{"", string(make([]byte, 65))} {
			_, err := svc.UpsertPreference(t.Context(), "u1", typ, &no, nil)
			var we *webx.Error
			require.ErrorAs(t, err, &we, "type=%q", typ)
			assert.Equal(t, webx.CodeValidation, we.Code)
		}
	})

	t.Run("Upsert 透传指针语义(只更新非 nil 渠道)", func(t *testing.T) {
		g := &fakeGate{}
		svc := newSvc(&fakeRepo{}, g)
		no := false
		_, err := svc.UpsertPreference(t.Context(), "u1", "quota_near_limit", nil, &no)
		require.NoError(t, err)
		require.Len(t, g.upserts, 1)
		assert.Equal(t, "u1", g.upserts[0].userID)
		assert.Equal(t, "quota_near_limit", g.upserts[0].typ)
		assert.Nil(t, g.upserts[0].email, "email 未出现应保持原值")
		require.NotNil(t, g.upserts[0].inApp)
		assert.False(t, *g.upserts[0].inApp)
	})

	t.Run("Upsert 未挂载闸门返回 E_UNAVAILABLE", func(t *testing.T) {
		svc := app.NewNotifyService(&fakeRepo{}, nil, func() time.Time { return frozen })
		yes := true
		_, err := svc.UpsertPreference(t.Context(), "u1", "quota_near_limit", &yes, nil)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusServiceUnavailable, we.Status)
		assert.Equal(t, webx.CodeUnavailable, we.Code)
	})
}

type prefMail struct{ sent [][3]string }

func (m *prefMail) SendLoginCode(context.Context, string, string) error      { return nil }
func (m *prefMail) SendInvite(context.Context, string, string, string) error { return nil }
func (m *prefMail) Send(_ context.Context, to, subject, body string) error {
	m.sent = append(m.sent, [3]string{to, subject, body})
	return nil
}

func TestSendTypeEmail_EmailGate(t *testing.T) {
	ctx := t.Context()

	t.Run("闸门关闭 → 静默跳过", func(t *testing.T) {
		mail := &prefMail{}
		svc := app.NewNotifyService(&fakeRepo{}, mail, func() time.Time { return frozen }).
			WithPrefGate(&fakeGate{allowed: false})
		require.NoError(t, svc.SendTypeEmail(ctx, "u1", "quota_near_limit", "u1@x.co", "s", "b"))
		assert.Empty(t, mail.sent)
	})
	t.Run("闸门放行/故障放行 → 发送", func(t *testing.T) {
		mail := &prefMail{}
		svc := app.NewNotifyService(&fakeRepo{}, mail, func() time.Time { return frozen }).
			WithPrefGate(&fakeGate{allowed: true})
		require.NoError(t, svc.SendTypeEmail(ctx, "u1", "quota_near_limit", "u1@x.co", "s", "b"))
		require.Len(t, mail.sent, 1)

		mail2 := &prefMail{}
		svc2 := app.NewNotifyService(&fakeRepo{}, mail2, func() time.Time { return frozen }).
			WithPrefGate(&fakeGate{gateErr: errors.New("down")})
		require.NoError(t, svc2.SendTypeEmail(ctx, "u1", "quota_near_limit", "u1@x.co", "s", "b"))
		assert.Len(t, mail2.sent, 1, "闸门故障 best-effort 放行")
	})
	t.Run("nil 闸门全放行；SendEmail 原始通道不查闸门", func(t *testing.T) {
		mail := &prefMail{}
		svc := app.NewNotifyService(&fakeRepo{}, mail, func() time.Time { return frozen })
		require.NoError(t, svc.SendTypeEmail(ctx, "u1", "quota_near_limit", "u1@x.co", "s", "b"))
		require.NoError(t, svc.SendEmail(ctx, "u1@x.co", "s2", "b2"))
		require.Len(t, mail.sent, 2)
	})
}

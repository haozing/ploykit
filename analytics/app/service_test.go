package app_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/analytics/app"
	"github.com/haozing/ploykit/platform/webx"
)

type fakeRepo struct {
	events       []app.Event
	nows         []time.Time
	recentLimits []int
	recentAll    []int
	recentSince  []time.Time
}

func (f *fakeRepo) Track(_ context.Context, e app.Event, now time.Time) {
	f.events = append(f.events, e)
	f.nows = append(f.nows, now)
}

func (f *fakeRepo) RecentByType(_ context.Context, _ string, limit int) ([]app.EventRow, error) {
	f.recentLimits = append(f.recentLimits, limit)
	return nil, nil
}

func (f *fakeRepo) Recent(_ context.Context, since time.Time, limit int) ([]app.EventRow, error) {
	f.recentAll = append(f.recentAll, limit)
	f.recentSince = append(f.recentSince, since)
	return []app.EventRow{{ID: 7, Type: "checkout_started", CreatedAt: time.Date(2026, 10, 8, 9, 0, 0, 0, time.UTC)}}, nil
}

func (f *fakeRepo) CountByType(context.Context, string, time.Time) (int, error) { return 0, nil }

func (f *fakeRepo) CountByTypeInWorkspace(context.Context, string, string, time.Time) (int, error) {
	return 0, nil
}

func TestTrack_PayloadRedactedByDefault(t *testing.T) {
	token := "ghp_" + strings.Repeat("x1y2z3", 7)
	openai := "sk-proj-" + strings.Repeat("a1b2c3", 7)

	in := map[string]any{
		"credentials": map[string]any{
			"github_token": token,
			"openai_key":   openai,
			"password":     "postgres://app:s3cretpw@db.internal:5432/prod",
			"note":         "regular text stays",
			"attempts":     3,
		},
		"attachments": []any{
			map[string]any{"aws_key": "AKIAIOSFODNN7EXAMPLE"},
			"plain.txt",
		},
		"plan": "pro",
	}

	repo := &fakeRepo{}
	svc := app.NewTrackService(repo, nil)
	svc.Track(t.Context(), app.Event{Type: "checkout_started", Payload: in})

	require.Len(t, repo.events, 1)
	got := repo.events[0].Payload
	require.NotNil(t, got)

	creds := got["credentials"].(map[string]any)
	assert.Contains(t, creds["github_token"], "[REDACTED:github_token]", "嵌套 map 中 token 字段被清洗")
	assert.Contains(t, creds["openai_key"], "[REDACTED:openai_key]")
	pwd, ok := creds["password"].(string)
	require.True(t, ok)
	assert.Contains(t, pwd, "[REDACTED:conn_string]", "password 字段的连接串密码被清洗")
	assert.NotContains(t, pwd, "s3cretpw")
	assert.Equal(t, "regular text stays", creds["note"], "普通字符串字段不动")
	assert.Equal(t, 3, creds["attempts"], "非字符串字段不动")

	atts := got["attachments"].([]any)
	assert.Contains(t, atts[0].(map[string]any)["aws_key"], "[REDACTED:aws_access_key]", "slice 内嵌 map 被递归清洗")
	assert.Equal(t, "plain.txt", atts[1], "slice 普通元素不动")
	assert.Equal(t, "pro", got["plan"])

	assert.Equal(t, token, in["credentials"].(map[string]any)["github_token"], "原始 payload 不被就地修改")
}

func TestTrack_NilAndEmptyPayload(t *testing.T) {
	repo := &fakeRepo{}
	svc := app.NewTrackService(repo, nil)

	svc.Track(t.Context(), app.Event{Type: "page_view", Payload: nil})
	require.Len(t, repo.events, 1)
	assert.Nil(t, repo.events[0].Payload, "nil payload 应保持 nil")

	svc.Track(t.Context(), app.Event{Type: "page_view", Payload: map[string]any{}})
	require.Len(t, repo.events, 2)
	assert.Empty(t, repo.events[1].Payload, "空 map 应保持空 map")
}

func TestRecentByType_LimitNormalization(t *testing.T) {
	cases := map[int]int{-5: 50, 0: 50, 1: 1, 8: 8, 200: 200, 201: 50}
	for in, want := range cases {
		repo := &fakeRepo{}
		svc := app.NewTrackService(repo, nil)
		_, err := svc.RecentByType(t.Context(), "t", in)
		require.NoError(t, err)
		require.Len(t, repo.recentLimits, 1)
		assert.Equal(t, want, repo.recentLimits[0], "limit=%d 应归一为 %d", in, want)
	}
}

func TestRecent_LimitNormalization(t *testing.T) {
	cases := map[int]int{-5: 20, 0: 20, 1: 1, 20: 20, 100: 100, 101: 20, 200: 20}
	for in, want := range cases {
		repo := &fakeRepo{}
		svc := app.NewTrackService(repo, nil)
		_, err := svc.Recent(t.Context(), in)
		require.NoError(t, err)
		require.Len(t, repo.recentAll, 1)
		assert.Equal(t, want, repo.recentAll[0], "limit=%d 应归一为 %d", in, want)
	}
}

func TestRecent_DelegatesToRepo(t *testing.T) {
	repo := &fakeRepo{}
	svc := app.NewTrackService(repo, nil)
	rows, err := svc.Recent(t.Context(), 30)
	require.NoError(t, err)
	require.Len(t, repo.recentAll, 1)
	assert.Equal(t, 30, repo.recentAll[0])
	require.Len(t, repo.recentSince, 1)
	assert.WithinDuration(t, time.Now().Add(-30*24*time.Hour), repo.recentSince[0], time.Minute,
		"P2-17：Recent 必须携带 30 天时间窗下界（分区裁剪谓词）")
	require.Len(t, rows, 1)
	assert.Equal(t, "checkout_started", rows[0].Type)
	assert.Empty(t, repo.recentLimits, "全类型变体不得走 RecentByType 端口")
}

func TestNewTrackService_NilLogger(t *testing.T) {
	repo := &fakeRepo{}
	assert.NotNil(t, app.NewTrackService(repo, nil))
	assert.NotPanics(t, func() {
		app.NewTrackService(repo, nil).Track(t.Context(), app.Event{Type: "t"})
	})
	require.Len(t, repo.events, 1)
	assert.Equal(t, "t", repo.events[0].Type)
}

func TestTrack_Validation(t *testing.T) {
	const wsUUID = "6f9619ff-8b86-d011-b42d-00c04fc964ff"
	cases := []struct {
		name    string
		event   app.Event
		wantErr bool
	}{
		{
			name: "全边界：type/entity_type=64、entity_id=128 放行",
			event: app.Event{
				WorkspaceID: wsUUID,
				Type:        strings.Repeat("a", 64),
				EntityType:  strings.Repeat("e", 64),
				EntityID:    strings.Repeat("i", 128),
			},
			wantErr: false,
		},
		{
			name:    "type=65 拒绝",
			event:   app.Event{WorkspaceID: wsUUID, Type: strings.Repeat("a", 65)},
			wantErr: true,
		},
		{
			name:    "entity_type=65 拒绝",
			event:   app.Event{WorkspaceID: wsUUID, Type: "t", EntityType: strings.Repeat("e", 65)},
			wantErr: true,
		},
		{
			name:    "entity_id=129 拒绝",
			event:   app.Event{WorkspaceID: wsUUID, Type: "t", EntityID: strings.Repeat("i", 129)},
			wantErr: true,
		},
		{
			name:    "空 workspace 放行（公开页事件无工作区）",
			event:   app.Event{Type: "page_view"},
			wantErr: false,
		},
		{
			name:    "workspace 非法 UUID 拒绝（空允许、非空必须 UUID）",
			event:   app.Event{WorkspaceID: "not-a-uuid", Type: "t"},
			wantErr: true,
		},
		{
			name: "rune 语义：64 个多字节字符放行（字节数 192>64，按 rune 计不超限）",
			event: app.Event{
				WorkspaceID: wsUUID,
				Type:        strings.Repeat("界", 64),
			},
			wantErr: false,
		},
		{
			name:    "rune 语义：65 个多字节字符拒绝",
			event:   app.Event{WorkspaceID: wsUUID, Type: strings.Repeat("界", 65)},
			wantErr: true,
		},
		{

			name:    "type 空串拒绝（P3-29）",
			event:   app.Event{WorkspaceID: wsUUID, Type: ""},
			wantErr: true,
		},
		{

			name:    "user_id 非法 UUID 拒绝（P2-18，空允许）",
			event:   app.Event{Type: "t", UserID: "not-a-uuid"},
			wantErr: true,
		},
		{
			name:    "user_id 合法 UUID 放行（P2-18）",
			event:   app.Event{Type: "t", UserID: wsUUID},
			wantErr: false,
		},
		{

			name: "payload 超 16KiB 拒绝（P3-31）",
			event: app.Event{Type: "t", Payload: map[string]any{
				"blob": strings.Repeat("x", 17<<10),
			}},
			wantErr: true,
		},
		{
			name: "payload 15KiB 放行（P3-31 边界内）",
			event: app.Event{Type: "t", Payload: map[string]any{
				"blob": strings.Repeat("x", 15<<10),
			}},
			wantErr: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{}
			svc := app.NewTrackService(repo, nil)
			err := svc.Track(t.Context(), tc.event)

			if tc.wantErr {
				require.Error(t, err)
				var we *webx.Error
				require.ErrorAs(t, err, &we, "校验错误必须是 webx.Error（对齐 notify prefs 风格）")
				assert.Equal(t, http.StatusBadRequest, we.Status)
				assert.Equal(t, webx.CodeValidation, we.Code)
				assert.Empty(t, repo.events, "校验失败的事件不得落库")
				return
			}
			require.NoError(t, err)
			require.Len(t, repo.events, 1, "合法事件应照旧落库")
		})
	}
}

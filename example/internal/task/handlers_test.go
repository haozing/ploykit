package task

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	analyticspg "github.com/haozing/ploykit/analytics/adapters/pgrepo"
	analyticsapp "github.com/haozing/ploykit/analytics/app"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/quota"
)

func TestValidateTitle_FT28_DQDEF5(t *testing.T) {
	cases := []struct {
		raw    string
		want   string
		wantOK bool
		runes  int
	}{
		{raw: "", want: "", wantOK: false},
		{raw: "   \t\n  ", want: "", wantOK: false},
		{raw: "a", want: "a", wantOK: true},
		{raw: "  世界  ", want: "世界", wantOK: true},
		{raw: strings.Repeat("世", 200), want: strings.Repeat("世", 200), wantOK: true},
		{raw: strings.Repeat("世", 201), want: strings.Repeat("世", 201), wantOK: false},
		{raw: strings.Repeat("a", 201), want: strings.Repeat("a", 201), wantOK: false},
	}
	for _, c := range cases {
		got, ok := validateTitle(c.raw)
		assert.Equal(t, c.wantOK, ok, "raw=%q", firstN(c.raw, 12))
		assert.Equal(t, c.want, got)
	}
}

func firstN(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func TestCreateDecodeJSONSingleError_SECV10(t *testing.T) {
	d := Deps{}
	r := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader("not-json"))
	w := httptest.NewRecorder()
	d.create(w, r, &webx.Principal{WorkspaceID: "ws"})

	assert.Equal(t, http.StatusBadRequest, w.Code)
	var body map[string]any
	dec := json.NewDecoder(w.Body)
	require.NoError(t, dec.Decode(&body))
	assert.Equal(t, "E_BAD_JSON", body["error"])

	err := dec.Decode(&body)
	assert.ErrorIs(t, err, io.EOF, "响应体应只有一个 JSON 对象，实际: %s", w.Body.String())
}

func TestCreateTitleRejectedBeforeQuota_FT28(t *testing.T) {
	d := Deps{}
	for _, title := range []string{"   ", strings.Repeat("a", 201), strings.Repeat("界", 201)} {
		r := httptest.NewRequest(http.MethodPost, "/api/tasks",
			strings.NewReader(`{"title":"`+title+`"}`))
		w := httptest.NewRecorder()
		d.create(w, r, &webx.Principal{WorkspaceID: "ws"})
		assert.Equal(t, http.StatusBadRequest, w.Code, "title=%s", firstN(title, 12))
		var body webx.ErrorBody
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.Equal(t, "E_VALIDATION", body.Code)
		assert.Contains(t, body.Message, "title")
	}
}

func TestUpdateValidation_E2ED9(t *testing.T) {
	d := Deps{}

	t.Run("无字段", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPatch, "/api/tasks/x", strings.NewReader(`{}`))
		w := httptest.NewRecorder()
		d.update(w, r, &webx.Principal{WorkspaceID: "ws"})
		assert.Equal(t, http.StatusBadRequest, w.Code)
		var body webx.ErrorBody
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.Equal(t, "E_VALIDATION", body.Code)
	})

	t.Run("title 越界", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPatch, "/api/tasks/x",
			strings.NewReader(`{"title":"`+strings.Repeat("a", 201)+`"}`))
		w := httptest.NewRecorder()
		d.update(w, r, &webx.Principal{WorkspaceID: "ws"})
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("坏 JSON 单错误体", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPatch, "/api/tasks/x", strings.NewReader("{"))
		w := httptest.NewRecorder()
		d.update(w, r, &webx.Principal{WorkspaceID: "ws"})
		assert.Equal(t, http.StatusBadRequest, w.Code)
		var body map[string]any
		dec := json.NewDecoder(w.Body)
		require.NoError(t, dec.Decode(&body))
		assert.ErrorIs(t, dec.Decode(&body), io.EOF)
	})
}

func TestPublishWsPort_E2ED1(t *testing.T) {
	t.Run("nil 不 panic", func(t *testing.T) {
		d := Deps{}
		assert.NotPanics(t, func() {
			d.publishWs(KindTaskCreated, Task{ID: "t-1"}, "ws-1")
		})
	})

	t.Run("payload 带 workspace_id 与 task", func(t *testing.T) {
		var gotEvent string
		var gotPayload map[string]any
		d := Deps{Publish: func(event string, payload any) {
			gotEvent = event
			gotPayload = payload.(map[string]any)
		}}
		tk := Task{ID: "t-1", Number: 7, Title: "写周报", Done: true}
		d.publishWs(wsEventDeleted, tk, "ws-9")
		assert.Equal(t, "task.deleted", gotEvent)
		assert.Equal(t, "ws-9", gotPayload["workspace_id"])
		assert.Equal(t, tk, gotPayload["task"])
	})
}

type capturedWsEvent struct {
	Event   string
	Payload map[string]any
}

type releaseCall struct {
	WorkspaceID string
	Key         string
	N           int64
}

type fakeQuotaPort struct {
	mu       sync.Mutex
	releases []releaseCall
}

func (f *fakeQuotaPort) Consume(context.Context, string, string, int64, time.Time) error {
	return nil
}

func (f *fakeQuotaPort) Release(_ context.Context, ws, key string, n int64, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.releases = append(f.releases, releaseCall{WorkspaceID: ws, Key: key, N: n})
	return nil
}

type taskEnv struct {
	pool                *pgxpool.Pool
	d                   *Deps
	userID, wsID, wsAlt string
	mu                  sync.Mutex
	events              []capturedWsEvent
}

func newTaskEnv(t *testing.T) *taskEnv {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	uniq := time.Now().UnixNano()
	email := fmt.Sprintf("taskfix-%d@test.local", uniq)
	var uid string
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'task fix test') RETURNING id`, email).
		Scan(&uid))
	mkWs := func(name string) string {
		var id string
		slug := fmt.Sprintf("tf-%d-%s", uniq, strings.ToLower(name))
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO workspace (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id`,
			slug, name, uid).Scan(&id))
		return id
	}
	wsID, wsAlt := mkWs("Main"), mkWs("Alt")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM analytics_event WHERE workspace_id IN ($1, $2)`, wsID, wsAlt)
		_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id IN ($1, $2)`, wsID, wsAlt)
		_, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid)
	})

	e := &taskEnv{pool: pool, userID: uid, wsID: wsID, wsAlt: wsAlt}
	e.d = &Deps{
		Pool:      pool,
		Quota:     quota.NewService(pool),
		Analytics: analyticsapp.NewTrackService(analyticspg.New(pool, nil), nil),
		Publish: func(event string, payload any) {
			e.mu.Lock()
			defer e.mu.Unlock()
			e.events = append(e.events, capturedWsEvent{Event: event, Payload: payload.(map[string]any)})
		},
	}
	return e
}

func (e *taskEnv) principal(wsID string) *webx.Principal {
	return &webx.Principal{UserID: e.userID, WorkspaceID: wsID, Source: webx.SourceSession}
}

func (e *taskEnv) recordedEvents() []capturedWsEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]capturedWsEvent(nil), e.events...)
}

func (e *taskEnv) doCreate(t *testing.T, title, idemKey, wsID string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{"title":`+quoteJSON(title)+`}`))
	if idemKey != "" {
		r.Header.Set("Idempotency-Key", idemKey)
	}
	w := httptest.NewRecorder()
	e.d.create(w, r, e.principal(wsID))
	return w
}

func quoteJSON(s string) string { b, _ := json.Marshal(s); return string(b) }

func (e *taskEnv) doPatch(t *testing.T, taskID, body, wsID string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPatch, "/api/tasks/"+taskID, strings.NewReader(body))
	r.SetPathValue("taskId", taskID)
	w := httptest.NewRecorder()
	e.d.update(w, r, e.principal(wsID))
	return w
}

func (e *taskEnv) doDelete(t *testing.T, taskID, wsID string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodDelete, "/api/tasks/"+taskID, nil)
	r.SetPathValue("taskId", taskID)
	w := httptest.NewRecorder()
	e.d.delete(w, r, e.principal(wsID))
	return w
}

func (e *taskEnv) doGet(t *testing.T, taskID, wsID string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/tasks/"+taskID, nil)
	r.SetPathValue("taskId", taskID)
	w := httptest.NewRecorder()
	e.d.get(w, r, e.principal(wsID))
	return w
}

func (e *taskEnv) doList(t *testing.T, wsID string) []Task {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	w := httptest.NewRecorder()
	e.d.list(w, r, e.principal(wsID))
	require.Equal(t, http.StatusOK, w.Code)
	var out []Task
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return out
}

func (e *taskEnv) doStats(t *testing.T, wsID string) (int, *httptest.ResponseRecorder) {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/task-stats", nil)
	w := httptest.NewRecorder()
	e.d.stats(w, r, e.principal(wsID))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var body struct {
		Created24h int `json:"task_created_24h"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	return body.Created24h, w
}

func (e *taskEnv) createTask(t *testing.T, title string) Task {
	t.Helper()
	w := e.doCreate(t, title, "", e.wsID)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var tk Task
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &tk))
	return tk
}

func TestUpdateTask_E2ED9(t *testing.T) {
	e := newTaskEnv(t)
	tk := e.createTask(t, "原始标题")
	require.Nil(t, tk.UpdatedAt)

	t.Run("改标题 → 200 返回更新后任务", func(t *testing.T) {
		w := e.doPatch(t, tk.ID, `{"title":"新标题"}`, e.wsID)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var got Task
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.Equal(t, tk.ID, got.ID)
		assert.Equal(t, "新标题", got.Title)
		assert.False(t, got.Done)
		require.NotNil(t, got.UpdatedAt)

		w2 := e.doGet(t, tk.ID, e.wsID)
		require.Equal(t, http.StatusOK, w2.Code)
		var again Task
		require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &again))
		assert.Equal(t, "新标题", again.Title)
	})

	t.Run("done=true → 200 且发 task.completed", func(t *testing.T) {
		before := len(e.recordedEvents())
		w := e.doPatch(t, tk.ID, `{"done":true}`, e.wsID)
		require.Equal(t, http.StatusOK, w.Code)
		var got Task
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.True(t, got.Done)

		evs := e.recordedEvents()
		require.Len(t, evs, before+1)
		last := evs[len(evs)-1]
		assert.Equal(t, "task.completed", last.Event)
		assert.Equal(t, e.wsID, last.Payload["workspace_id"])
		assert.Equal(t, tk.ID, last.Payload["task"].(Task).ID)
	})

	t.Run("不存在 → 404", func(t *testing.T) {
		w := e.doPatch(t, "00000000-0000-0000-0000-000000000000", `{"done":true}`, e.wsID)
		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("跨工作区 → 404（归属口径同列表）", func(t *testing.T) {
		other := e.createTask(t, "主工作区任务")
		w := e.doPatch(t, other.ID, `{"title":"越权改"}`, e.wsAlt)
		assert.Equal(t, http.StatusNotFound, w.Code)

		got := e.doGet(t, other.ID, e.wsID)
		require.Equal(t, http.StatusOK, got.Code)
		var tk Task
		require.NoError(t, json.Unmarshal(got.Body.Bytes(), &tk))
		assert.Equal(t, "主工作区任务", tk.Title)
	})

	t.Run("title 同时改 → 200", func(t *testing.T) {
		w := e.doPatch(t, tk.ID, `{"title":"双改","done":false}`, e.wsID)
		require.Equal(t, http.StatusOK, w.Code)
		var got Task
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.Equal(t, "双改", got.Title)
		assert.False(t, got.Done)
	})
}

func TestDeleteTask_SoftDelete_E2ED9(t *testing.T) {
	e := newTaskEnv(t)
	fq := &fakeQuotaPort{}
	e.d.QuotaReleaser = fq

	a := e.createTask(t, "任务A")
	b := e.createTask(t, "任务B")

	t.Run("首次删除 → 204 + 配额回退 + task.deleted", func(t *testing.T) {
		before := len(e.recordedEvents())
		w := e.doDelete(t, a.ID, e.wsID)
		require.Equal(t, http.StatusNoContent, w.Code)
		assert.Empty(t, w.Body.String())

		fq.mu.Lock()
		require.Len(t, fq.releases, 1)
		assert.Equal(t, releaseCall{WorkspaceID: e.wsID, Key: "tasks_monthly", N: 1}, fq.releases[0])
		fq.mu.Unlock()

		evs := e.recordedEvents()
		require.Len(t, evs, before+1)
		assert.Equal(t, "task.deleted", evs[len(evs)-1].Event)
		assert.Equal(t, a.ID, evs[len(evs)-1].Payload["task"].(Task).ID)
	})

	t.Run("重复删除 → 404", func(t *testing.T) {
		assert.Equal(t, http.StatusNotFound, e.doDelete(t, a.ID, e.wsID).Code)
	})

	t.Run("已删行从详情/列表/done 中消失", func(t *testing.T) {
		assert.Equal(t, http.StatusNotFound, e.doGet(t, a.ID, e.wsID).Code)
		for _, tk := range e.doList(t, e.wsID) {
			assert.NotEqual(t, a.ID, tk.ID)
		}
		names := taskTitles(e.doList(t, e.wsID))
		assert.Contains(t, names, "任务B")

		r := httptest.NewRequest(http.MethodPost, "/api/tasks/"+a.ID+"/done", nil)
		r.SetPathValue("taskId", a.ID)
		w := httptest.NewRecorder()
		e.d.done(w, r, e.principal(e.wsID))
		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("行仍在库（removed_at 标记）且号码不复用", func(t *testing.T) {
		var removed int
		require.NoError(t, e.pool.QueryRow(context.Background(),
			`SELECT count(*) FROM task WHERE id = $1 AND removed_at IS NOT NULL`, a.ID).Scan(&removed))
		assert.Equal(t, 1, removed, "软删应保留行并标记 removed_at")

		c := e.createTask(t, "任务C")
		assert.Equal(t, b.Number+1, c.Number, "已删任务的号码不应被复用")
	})

	t.Run("属主判定排除已删行", func(t *testing.T) {
		rLive := httptest.NewRequest(http.MethodPost, "/api/tasks/"+b.ID+"/done", nil)
		rLive.SetPathValue("taskId", b.ID)
		assert.True(t, e.d.taskOwner(rLive, e.principal(e.wsID)), "存活行属主判定不受影响")

		r := httptest.NewRequest(http.MethodPost, "/api/tasks/"+a.ID+"/done", nil)
		r.SetPathValue("taskId", a.ID)
		assert.False(t, e.d.taskOwner(r, e.principal(e.wsID)))
	})
}

func taskTitles(ts []Task) []string {
	out := make([]string, len(ts))
	for i, tk := range ts {
		out[i] = tk.Title
	}
	return out
}

func TestDeleteReleasesQuotaLedger_DQDEF1(t *testing.T) {
	e := newTaskEnv(t)
	e.d.QuotaReleaser = e.d.Quota
	ctx := context.Background()

	used := func() int64 {
		st, err := e.d.Quota.Check(ctx, e.wsID, "tasks_monthly", time.Now())
		require.NoError(t, err)
		return st.Used
	}
	require.Zero(t, used())

	a := e.createTask(t, "A")
	e.createTask(t, "B")
	assert.EqualValues(t, 2, used())

	w := e.doDelete(t, a.ID, e.wsID)
	require.Equal(t, http.StatusNoContent, w.Code)
	assert.EqualValues(t, 1, used(), "删除后 used 应回落 1")
}

func TestCreateIdempotency_FT24(t *testing.T) {
	e := newTaskEnv(t)

	t.Run("同 key 重放返回已存在行（200）且不重复落库", func(t *testing.T) {
		w1 := e.doCreate(t, "幂等任务", "idem-1", e.wsID)
		require.Equal(t, http.StatusCreated, w1.Code)
		var first Task
		require.NoError(t, json.Unmarshal(w1.Body.Bytes(), &first))

		w2 := e.doCreate(t, "幂等任务", "idem-1", e.wsID)
		require.Equal(t, http.StatusOK, w2.Code, "重放选 200（非新建）")
		var second Task
		require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &second))
		assert.Equal(t, first.ID, second.ID)

		var n int
		require.NoError(t, e.pool.QueryRow(context.Background(),
			`SELECT count(*) FROM task WHERE workspace_id=$1 AND idempotency_key='idem-1'`,
			e.wsID).Scan(&n))
		assert.Equal(t, 1, n)
	})

	t.Run("不带 key 行为不变（各建各行）", func(t *testing.T) {
		e.createTask(t, "普通1")
		e.createTask(t, "普通2")
	})

	t.Run("并发 5 发同 key → 恰一行、全 2xx", func(t *testing.T) {
		var wg sync.WaitGroup
		results := make([]*httptest.ResponseRecorder, 5)
		for i := range 5 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				results[i] = e.doCreate(t, "并发幂等", "idem-race", e.wsID)
			}()
		}
		wg.Wait()
		created := 0
		for _, w := range results {
			require.Contains(t, []int{http.StatusOK, http.StatusCreated}, w.Code, w.Body.String())
			if w.Code == http.StatusCreated {
				created++
			}
		}
		assert.Equal(t, 1, created)
		var n int
		require.NoError(t, e.pool.QueryRow(context.Background(),
			`SELECT count(*) FROM task WHERE workspace_id=$1 AND idempotency_key='idem-race' AND removed_at IS NULL`,
			e.wsID).Scan(&n))
		assert.Equal(t, 1, n)
	})

	t.Run("删除后同 key 可再建（软删行不占幂等键）", func(t *testing.T) {
		w1 := e.doCreate(t, "删后重建", "idem-re", e.wsID)
		require.Equal(t, http.StatusCreated, w1.Code)
		var first Task
		require.NoError(t, json.Unmarshal(w1.Body.Bytes(), &first))
		require.Equal(t, http.StatusNoContent, e.doDelete(t, first.ID, e.wsID).Code)

		w2 := e.doCreate(t, "删后重建", "idem-re", e.wsID)
		assert.Equal(t, http.StatusCreated, w2.Code, "旧行已软删，同 key 再建是新资源")
		var second Task
		require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &second))
		assert.NotEqual(t, first.ID, second.ID)
	})
}

func TestStatsWorkspaceScoped_FT214(t *testing.T) {
	e := newTaskEnv(t)
	e.createTask(t, "主区任务1")
	e.createTask(t, "主区任务2")

	r := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{"title":"别区任务"}`))
	w := httptest.NewRecorder()
	e.d.create(w, r, e.principal(e.wsAlt))
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())

	t.Run("主工作区只计自己 2 条", func(t *testing.T) {
		n, _ := e.doStats(t, e.wsID)
		assert.Equal(t, 2, n)
	})
	t.Run("另一工作区只计自己 1 条", func(t *testing.T) {
		n, _ := e.doStats(t, e.wsAlt)
		assert.Equal(t, 1, n)
	})
	t.Run("旧 CountByType（无过滤参数）保持全平台口径", func(t *testing.T) {
		n, err := e.d.Analytics.CountByType(context.Background(), "task_created", time.Now().Add(-24*time.Hour))
		require.NoError(t, err)
		assert.GreaterOrEqual(t, n, 3, "跨工作区聚合旧行为不变（可能含库内其他历史事件）")
	})
}

type failingStatsRepo struct{}

func (failingStatsRepo) Track(context.Context, analyticsapp.Event, time.Time) {}
func (failingStatsRepo) RecentByType(context.Context, string, int) ([]analyticsapp.EventRow, error) {
	return nil, nil
}
func (failingStatsRepo) Recent(context.Context, time.Time, int) ([]analyticsapp.EventRow, error) {
	return nil, nil
}
func (failingStatsRepo) CountByType(context.Context, string, time.Time) (int, error) {
	return 0, nil
}
func (failingStatsRepo) CountByTypeInWorkspace(context.Context, string, string, time.Time) (int, error) {
	return 0, errors.New("db down")
}

func TestStatsQueryFailureIs500_FT214(t *testing.T) {
	d := Deps{Analytics: analyticsapp.NewTrackService(failingStatsRepo{}, nil)}
	r := httptest.NewRequest(http.MethodGet, "/api/task-stats", nil)
	w := httptest.NewRecorder()
	d.stats(w, r, &webx.Principal{WorkspaceID: "ws"})
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestCreateConcurrentNumbers_FT23(t *testing.T) {
	e := newTaskEnv(t)
	const n = 5
	var wg sync.WaitGroup
	results := make([]*httptest.ResponseRecorder, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = e.doCreate(t, fmt.Sprintf("并发任务%d", i), "", e.wsID)
		}()
	}
	wg.Wait()

	numbers := map[int64]bool{}
	for i, w := range results {
		require.Equal(t, http.StatusCreated, w.Code, "第 %d 发: %s", i, w.Body.String())
		var tk Task
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &tk))
		assert.False(t, numbers[tk.Number], "号码必须唯一: %d", tk.Number)
		numbers[tk.Number] = true
	}
	assert.Len(t, numbers, n)

	var rows int
	require.NoError(t, e.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM task WHERE workspace_id=$1 AND removed_at IS NULL`, e.wsID).Scan(&rows))
	assert.Equal(t, n, rows)

	createdEvents := 0
	for _, ev := range e.recordedEvents() {
		if ev.Event == "task.created" {
			createdEvents++
			assert.Equal(t, e.wsID, ev.Payload["workspace_id"])
		}
	}
	assert.Equal(t, n, createdEvents)
}

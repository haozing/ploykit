package schedulehttp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/schedule"
)

var fixedNow = time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)

type fakeRepo struct {
	plans map[string]schedule.SchedulePlan
}

func newFakeRepo(plans ...schedule.SchedulePlan) *fakeRepo {
	r := &fakeRepo{plans: map[string]schedule.SchedulePlan{}}
	for _, p := range plans {
		r.plans[p.WorkspaceID+"/"+p.ID] = p
	}
	return r
}

func (r *fakeRepo) Create(_ context.Context, p *schedule.SchedulePlan) error {
	r.plans[p.WorkspaceID+"/"+p.ID] = *p
	return nil
}

func (r *fakeRepo) Get(_ context.Context, workspaceID, id string) (schedule.SchedulePlan, error) {
	if p, ok := r.plans[workspaceID+"/"+id]; ok {
		return p, nil
	}
	return schedule.SchedulePlan{}, schedule.ErrNotFound
}

func (r *fakeRepo) ListByWorkspace(_ context.Context, workspaceID string) ([]schedule.SchedulePlan, error) {
	var out []schedule.SchedulePlan
	for _, p := range r.plans {
		if p.WorkspaceID == workspaceID {
			out = append(out, p)
		}
	}
	return out, nil
}

func (r *fakeRepo) Update(_ context.Context, p *schedule.SchedulePlan) error {
	if _, ok := r.plans[p.WorkspaceID+"/"+p.ID]; !ok {
		return schedule.ErrNotFound
	}
	r.plans[p.WorkspaceID+"/"+p.ID] = *p
	return nil
}

func (r *fakeRepo) Delete(_ context.Context, workspaceID, id string) error {
	if _, ok := r.plans[workspaceID+"/"+id]; !ok {
		return schedule.ErrNotFound
	}
	delete(r.plans, workspaceID+"/"+id)
	return nil
}

func (r *fakeRepo) ClaimDue(_ context.Context, _ time.Time, _ int) ([]schedule.Claimed, error) {
	return nil, nil
}

func testDeps(t *testing.T) Deps {
	t.Helper()
	return Deps{Service: schedule.NewService(newFakeRepo(), nil, func() time.Time { return fixedNow })}
}

func doJSON(t *testing.T, d Deps, method, target, body string, wsID string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if wsID == "" {
		wsID = "ws-1"
	}
	w := httptest.NewRecorder()
	switch {
	case method == "POST" && target == "/api/schedules":
		d.create(w, r, &webx.Principal{UserID: "u1", WorkspaceID: wsID})
	case method == "POST" && target == "/api/schedules/preview":
		d.preview(w, r, &webx.Principal{UserID: "u1", WorkspaceID: wsID})
	case method == "PATCH" && strings.HasPrefix(target, "/api/schedules/"):
		r.SetPathValue("id", strings.TrimPrefix(target, "/api/schedules/"))
		d.update(w, r, &webx.Principal{UserID: "u1", WorkspaceID: wsID})
	case method == "DELETE" && strings.HasPrefix(target, "/api/schedules/"):
		r.SetPathValue("id", strings.TrimPrefix(target, "/api/schedules/"))
		d.del(w, r, &webx.Principal{UserID: "u1", WorkspaceID: wsID})
	default:
		d.list(w, r, &webx.Principal{UserID: "u1", WorkspaceID: wsID})
	}
	return w
}

func TestCreateHandlerErrorMapping(t *testing.T) {
	d := testDeps(t)

	w := doJSON(t, d, "POST", "/api/schedules", `{"kind":"k","cron_expr":"bad"}`, "ws-1")
	assert.Equal(t, http.StatusBadRequest, w.Code)
	var body webx.ErrorBody
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "E_INVALID_CRON", body.Code)

	w = doJSON(t, d, "POST", "/api/schedules", `{"kind":"k","cron_expr":"0 9 * * *","timezone":"Nope/Zone"}`, "ws-1")
	assert.Equal(t, http.StatusBadRequest, w.Code)
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "E_INVALID_TZ", body.Code)

	w = doJSON(t, d, "POST", "/api/schedules", `{"kind":"task.cleanup","cron_expr":"0 9 * * *","timezone":"Asia/Shanghai"}`, "ws-1")
	assert.Equal(t, http.StatusCreated, w.Code)
	var plan schedule.SchedulePlan
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &plan))
	assert.Equal(t, "skip", plan.Misfire)
	assert.True(t, plan.NextFireAt.Equal(time.Date(2026, 10, 7, 1, 0, 0, 0, time.UTC)))
}

func TestPreviewHandler(t *testing.T) {
	d := testDeps(t)
	w := doJSON(t, d, "POST", "/api/schedules/preview", `{"cron_expr":"*/15 * * * *","timezone":"UTC"}`, "ws-1")
	assert.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Items []time.Time `json:"items"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Len(t, resp.Items, 3, "默认预览 3 次")

	w = doJSON(t, d, "POST", "/api/schedules/preview", `{"cron_expr":"bad"}`, "ws-1")
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestListHandler(t *testing.T) {
	d := testDeps(t)
	_, err := d.Service.Create(context.Background(), "ws-1", schedule.CreateInput{Kind: "k", CronExpr: "0 9 * * *"})
	require.NoError(t, err)
	w := doJSON(t, d, "GET", "/api/schedules", "", "ws-1")
	assert.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Items []schedule.SchedulePlan `json:"items"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Len(t, resp.Items, 1)
}

func TestUpdateHandlerNotFound(t *testing.T) {
	d := testDeps(t)
	w := doJSON(t, d, "PATCH", "/api/schedules/missing", `{"enabled":false}`, "ws-1")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestDeleteHandler(t *testing.T) {
	repo := newFakeRepo()
	d := Deps{Service: schedule.NewService(repo, nil, func() time.Time { return fixedNow })}
	_, err := d.Service.Create(context.Background(), "ws-1", schedule.CreateInput{Kind: "k", CronExpr: "0 9 * * *"})
	require.NoError(t, err)
	items, err := repo.ListByWorkspace(context.Background(), "ws-1")
	require.NoError(t, err)
	require.Len(t, items, 1)
	id := items[0].ID

	w := doJSON(t, d, "DELETE", "/api/schedules/"+id, "", "ws-1")
	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Empty(t, w.Body.Bytes(), "204 无响应体")

	w = doJSON(t, d, "GET", "/api/schedules", "", "ws-1")
	var resp struct {
		Items []schedule.SchedulePlan `json:"items"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Empty(t, resp.Items)

	w = doJSON(t, d, "DELETE", "/api/schedules/"+id, "", "ws-1")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

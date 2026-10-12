package devx

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivertype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/events"
	"github.com/haozing/ploykit/platform/ids"
)

// failingArgs is a job kind with no registered worker: it stays available
// until max attempts force it through states we can observe.
type failingArgs struct {
	Note string `json:"note"`
}

func (failingArgs) Kind() string { return "it.devx-failing" }

func newScratchPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	admin, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	scratch := "devx_it_" + ids.NewV4().String()[:8]
	_, err = admin.Exec(ctx, "CREATE DATABASE "+scratch)
	require.NoError(t, err, "scratch db (needs CREATEDB privilege)")

	u, err := url.Parse(dsn)
	require.NoError(t, err)
	u.Path = "/" + scratch
	pool, err := pgxpool.New(ctx, u.String())
	require.NoError(t, err)

	require.NoError(t, events.Migrate(ctx, pool))

	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer dropCancel()
		_, _ = admin.Exec(dropCtx, fmt.Sprintf("DROP DATABASE %s WITH (FORCE)", scratch))
		admin.Close()
	})
	return pool
}

// newJobEnv builds a river client (no workers started) plus the devx surface
// mounted over it; jobs inserted stay in the state we put them in.
func newJobEnv(t *testing.T) (*pgxpool.Pool, *http.ServeMux, *Deps) {
	t.Helper()
	pool := newScratchPool(t)

	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	require.NoError(t, err)

	deps := &Deps{Jobs: NewJobService(client)}
	mux := http.NewServeMux()
	Mount(mux, *deps)
	return pool, mux, deps
}

func insertJob(t *testing.T, pool *pgxpool.Pool, note string) int64 {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	_, err = client(t, pool).InsertTx(ctx, tx, failingArgs{Note: note}, nil)
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))
	var id int64
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM river_job WHERE kind = 'it.devx-failing' AND args->>'note' = $1`, note).Scan(&id))
	return id
}

func client(t *testing.T, pool *pgxpool.Pool) *river.Client[pgx.Tx] {
	t.Helper()
	c, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	require.NoError(t, err)
	return c
}

func TestJobs_HTTPListGetRetryCancel(t *testing.T) {
	pool, mux, _ := newJobEnv(t)
	ctx := context.Background()

	id := insertJob(t, pool, "list-me")

	// list: available state filter.
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/dev/jobs?state=available&kind=it.devx-failing", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var listBody struct {
		Jobs []JobSummary `json:"jobs"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &listBody))
	require.NotEmpty(t, listBody.Jobs)
	found := false
	for _, j := range listBody.Jobs {
		if j.ID == id {
			found = true
			assert.Equal(t, "available", j.State)
			assert.Equal(t, "it.devx-failing", j.Kind)
		}
	}
	require.True(t, found, "inserted job must appear in the available list")

	// get: args payload round-trips.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", fmt.Sprintf("/dev/jobs/%d", id), nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var detail JobDetail
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &detail))
	require.JSONEq(t, `{"note":"list-me"}`, string(detail.Args))

	// retry on an available job: river leaves it available, response is 200.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", fmt.Sprintf("/dev/jobs/%d/retry", id), nil))
	require.Equal(t, http.StatusOK, rec.Code)

	// cancel: available → cancelled.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", fmt.Sprintf("/dev/jobs/%d/cancel", id), nil))
	require.Equal(t, http.StatusOK, rec.Code)
	j, err := client(t, pool).JobGet(ctx, id)
	require.NoError(t, err)
	require.Equal(t, rivertype.JobStateCancelled, j.State)

	// get on a missing id → 404 with the sentinel message.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/dev/jobs/999999", nil))
	require.Equal(t, http.StatusNotFound, rec.Code)
	assert.Contains(t, rec.Body.String(), "job not found")

	// bad id → 400.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/dev/jobs/abc", nil))
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

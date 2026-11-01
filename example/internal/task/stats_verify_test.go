package task

// Adversarial verification demo (docs/testing-strategy.md rule 9; pattern
// from zijianfang's T4 audit lane, proposal 提案四 2026-11-01): ordinary
// tests ask "is the output correct"; the adversarial verifier asks "how do
// you prove you are not blind". Two mandatory halves:
//
//  1. INDEPENDENT RECOMPUTE — the GET /api/task-stats handler claims
//     task_created_24h via the analytics repo method; the verifier recounts
//     the same number through its own SQL against the schema contract
//     (DB-side now()/interval instead of the handler's Go-computed since),
//     sharing zero code with the path under test.
//  2. SEEDED-DEFECT SELF-TEST — feed the verifier a KNOWN lie (a repo
//     decorator that reports an obviously wrong constant) and assert the
//     verifier BITES. Without this, a passing "zero violations" proves
//     nothing — the verifier might be comparing nothing against itself.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	analyticspg "github.com/haozing/ploykit/analytics/adapters/pgrepo"
	analyticsapp "github.com/haozing/ploykit/analytics/app"
	"github.com/haozing/ploykit/platform/webx"
)

// claimedCount drives d.stats and returns the handler's claimed
// task_created_24h for the given workspace.
func claimedCount(t *testing.T, d *Deps, wsID string) int {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/task-stats", nil)
	w := httptest.NewRecorder()
	d.stats(w, r, &webx.Principal{WorkspaceID: wsID, UserID: "u", Source: webx.SourceSession})
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	var body struct {
		TaskCreated24h int `json:"task_created_24h"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	return body.TaskCreated24h
}

// independentTaskCreated24h recounts the claim with SQL that shares nothing
// with analyticspg.Repo.CountByTypeInWorkspace: the 24h window is computed by
// the database (now() - interval), not by the caller's clock.
func independentTaskCreated24h(t *testing.T, pool *pgxpool.Pool, wsID string) int {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(context.Background(), `
		SELECT count(*) FROM analytics_event
		WHERE workspace_id = $1 AND event_type = 'task_created'
		  AND created_at > now() - interval '24 hours'`, wsID).Scan(&n))
	return n
}

// lyingRepo seeds a known defect: every workspace-scoped count reports an
// obviously wrong constant. The self-test below first pins the true count, so
// claim != truth is guaranteed — catching the lie is the only way this
// verifier proves it is not idling.
type lyingRepo struct {
	analyticspg.Repo
}

func (lyingRepo) CountByTypeInWorkspace(context.Context, string, string, time.Time) (int, error) {
	return 99999, nil
}

func TestTaskStatsAdversarialVerify(t *testing.T) {
	e := newTaskEnv(t)

	// Seed an uneven number of tasks across two workspaces: the claim must be
	// workspace-scoped, and a cross-workspace leak shows up as a mismatch.
	for i := 0; i < 3; i++ {
		e.doCreate(t, "main task", "", e.wsID)
	}
	e.doCreate(t, "alt task", "", e.wsAlt)

	t.Run("independent recompute agrees with the handler's claim", func(t *testing.T) {
		claimed := claimedCount(t, e.d, e.wsID)
		truth := independentTaskCreated24h(t, e.pool, e.wsID)
		assert.Equal(t, 3, truth, "预置事实本身要成立（主工作区恰 3 条事件）")
		assert.Equal(t, truth, claimed,
			"handler 声称的 task_created_24h 必须与独立重算一致——引擎声称与独立证据分叉即是缺陷")
		// Scope is part of the claim: the alt workspace must not bleed in.
		assert.Equal(t, 1, independentTaskCreated24h(t, e.pool, e.wsAlt))
	})

	t.Run("seeded lie must be caught (verifier self-test)", func(t *testing.T) {
		d := &Deps{Analytics: analyticsapp.NewTrackService(&lyingRepo{}, nil)}
		claimed := claimedCount(t, d, e.wsID)
		truth := independentTaskCreated24h(t, e.pool, e.wsID)
		assert.NotEqual(t, truth, claimed,
			"核验器必须咬中植入的谎报——若此处相等，说明'零分歧'只是核验器空转，不是引擎正确")
	})
}

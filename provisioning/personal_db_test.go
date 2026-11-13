package provisioning

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/quota"
	workspacepg "github.com/haozing/ploykit/workspace/adapters/pgrepo"
	workspaceapp "github.com/haozing/ploykit/workspace/app"
)

func dbPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	require.NoError(t, pgmigrate.Up(context.Background(), pool, migrations.FS, "."), "framework migration chain (incl. 048 workspace.kind)")
	return pool
}

func seedUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO "user" (email, display_name) VALUES ($1, $2) RETURNING id`,
		fmt.Sprintf("prov-%s@test.local", uuid.NewString()[:12]), "provisioning tester").Scan(&id)
	require.NoError(t, err)
	t.Cleanup(func() {
		// workspace first (its created_by FK has no cascade), then the user;
		// workspace delete cascades member + quota_grant.
		_, _ = pool.Exec(context.Background(), `DELETE FROM workspace WHERE created_by = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, id)
	})
	return id
}

func testConfig(pool *pgxpool.Pool, credits ...Credit) (PersonalConfig, *workspacepg.Repo) {
	repo := workspacepg.New(pool)
	cfg := PersonalConfig{
		Pool:       pool,
		Workspaces: repo,
		Quota:      quota.NewService(pool),
		Credits:    credits,
	}
	return cfg, repo
}

func personalWorkspaceOf(t *testing.T, pool *pgxpool.Pool, userID string) (id, slug string, found bool) {
	t.Helper()
	err := pool.QueryRow(context.Background(),
		`SELECT id, slug FROM workspace WHERE created_by = $1 AND kind = 'personal'`, userID).
		Scan(&id, &slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", false
	}
	require.NoError(t, err)
	return id, slug, true
}

func countOwnerMembers(t *testing.T, pool *pgxpool.Pool, userID string) int {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(context.Background(), `
		SELECT count(*) FROM member m JOIN workspace w ON w.id = m.workspace_id
		WHERE w.created_by = $1 AND w.kind = 'personal' AND m.user_id = $1
		  AND m.role = 'owner' AND m.removed_at IS NULL`, userID).Scan(&n))
	return n
}

func countOnboardingGrants(t *testing.T, pool *pgxpool.Pool, userID string) (int, int64) {
	t.Helper()
	var n int
	var total int64
	require.NoError(t, pool.QueryRow(context.Background(), `
		SELECT count(*), COALESCE(sum(g.amount), 0) FROM quota_grant g
		JOIN workspace w ON w.id = g.workspace_id
		WHERE w.created_by = $1 AND w.kind = 'personal' AND g.reason = 'onboarding'`, userID).
		Scan(&n, &total))
	return n, total
}

// (a) ensure creates workspace(kind='personal') + owner membership + credits.
func TestPersonalEnsureProvisionsWorkspaceMembershipCredits(t *testing.T) {
	pool := dbPool(t)
	ctx := context.Background()
	uid := seedUser(t, pool)

	cfg, _ := testConfig(pool, Credit{Key: "tasks_monthly", Amount: 5})
	hooks := PersonalWorkspace(cfg)

	require.NoError(t, hooks.AfterRegister(ctx, uid))

	wsID, slug, found := personalWorkspaceOf(t, pool, uid)
	require.True(t, found, "personal workspace must exist after AfterRegister")
	require.Equal(t, personalSlug(uid), slug, "slug must be the deterministic my-<hex> form")

	var name, plan, kind string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT name, plan_code, kind FROM workspace WHERE id = $1`, wsID).Scan(&name, &plan, &kind))
	require.Equal(t, "Personal", name)
	require.Equal(t, "free", plan, "plan_code takes the column default")
	require.Equal(t, "personal", kind)

	require.Equal(t, 1, countOwnerMembers(t, pool, uid))
	n, total := countOnboardingGrants(t, pool, uid)
	require.Equal(t, 1, n)
	require.EqualValues(t, 5, total)

	// AfterLogin on a fresh session re-ensures through the same fast path.
	require.NoError(t, hooks.AfterLogin(ctx, uid, "session-1"))
}

// (b) replay is idempotent: no dup rows, no error.
func TestPersonalEnsureReplayIsIdempotent(t *testing.T) {
	pool := dbPool(t)
	ctx := context.Background()
	uid := seedUser(t, pool)

	cfg, _ := testConfig(pool, Credit{Key: "tasks_monthly", Amount: 5})
	hooks := PersonalWorkspace(cfg)
	require.NoError(t, hooks.AfterRegister(ctx, uid))

	for i := 0; i < 3; i++ {
		require.NoError(t, hooks.AfterRegister(ctx, uid), "replay %d", i+1)
		require.NoError(t, hooks.AfterLogin(ctx, uid, fmt.Sprintf("s-%d", i)))
	}

	_, _, found := personalWorkspaceOf(t, pool, uid)
	require.True(t, found)
	require.Equal(t, 1, countOwnerMembers(t, pool, uid))
	n, total := countOnboardingGrants(t, pool, uid)
	require.Equal(t, 1, n, "credits must not double-grant on replay")
	require.EqualValues(t, 5, total)
}

// flakyRepo simulates a JIT-path provisioning failure (process crash /
// transient error mid-transaction): the first CreatePersonalWorkspaceTx call
// fails, later calls delegate to the real repo.
type flakyRepo struct {
	workspaceapp.Repo
	calls int
}

func (f *flakyRepo) CreatePersonalWorkspaceTx(ctx context.Context, tx pgx.Tx, slug, ownerUserID string, now time.Time) (workspaceapp.Workspace, error) {
	f.calls++
	if f.calls == 1 {
		return workspaceapp.Workspace{}, errors.New("boom: simulated mid-provision failure")
	}
	return f.Repo.CreatePersonalWorkspaceTx(ctx, tx, slug, ownerUserID, now)
}

// (c) JIT-failure convergence: a failed ensure leaves nothing half-inserted
// (the transaction rolls back) and the NEXT ensure converges without error —
// the login-time re-ensure is the self-heal, no retry table involved.
func TestPersonalEnsureFailsThenConverges(t *testing.T) {
	pool := dbPool(t)
	ctx := context.Background()
	uid := seedUser(t, pool)

	repo := workspacepg.New(pool)
	cfg := PersonalConfig{
		Pool:       pool,
		Workspaces: &flakyRepo{Repo: repo},
		Quota:      quota.NewService(pool),
		Credits:    []Credit{{Key: "tasks_monthly", Amount: 5}},
	}
	hooks := PersonalWorkspace(cfg)

	err := hooks.AfterRegister(ctx, uid)
	require.ErrorContains(t, err, "boom")

	// Nothing persisted from the failed attempt.
	_, _, found := personalWorkspaceOf(t, pool, uid)
	require.False(t, found, "failed provisioning must roll back the workspace insert")
	require.Equal(t, 0, countOwnerMembers(t, pool, uid))
	n, total := countOnboardingGrants(t, pool, uid)
	require.Zero(t, n)
	require.Zero(t, total)

	// Next login re-ensures and converges fully.
	require.NoError(t, hooks.AfterLogin(ctx, uid, "session-after-failure"))
	wsID, _, found := personalWorkspaceOf(t, pool, uid)
	require.True(t, found)
	require.Equal(t, 1, countOwnerMembers(t, pool, uid))
	n, total = countOnboardingGrants(t, pool, uid)
	require.Equal(t, 1, n)
	require.EqualValues(t, 5, total)

	var creditsOnOther int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM quota_grant WHERE workspace_id <> $1 AND ref_id = $2`, wsID, wsID+":tasks_monthly").Scan(&creditsOnOther))
	require.Zero(t, creditsOnOther)
}

// (d) two users never collide: distinct personal workspaces, distinct slugs.
func TestPersonalEnsureTwoUsersNoCollision(t *testing.T) {
	pool := dbPool(t)
	ctx := context.Background()
	uidA := seedUser(t, pool)
	uidB := seedUser(t, pool)

	cfg, _ := testConfig(pool)
	hooks := PersonalWorkspace(cfg)
	require.NoError(t, hooks.AfterRegister(ctx, uidA))
	require.NoError(t, hooks.AfterRegister(ctx, uidB))

	idA, slugA, ok := personalWorkspaceOf(t, pool, uidA)
	require.True(t, ok)
	idB, slugB, ok := personalWorkspaceOf(t, pool, uidB)
	require.True(t, ok)
	require.NotEqual(t, idA, idB)
	require.NotEqual(t, slugA, slugB)
	require.Equal(t, 1, countOwnerMembers(t, pool, uidA))
	require.Equal(t, 1, countOwnerMembers(t, pool, uidB))
}

// (f) the lost-race branch: when the unique index fires beneath the inner
// re-check (two ensures racing past the fast path), CreatePersonalWorkspaceTx
// surfaces the 23505 as workspace ErrDuplicate and alreadyProvisioned maps it
// to "already provisioned" — the exact predicate ensure's tolerance relies on.
func TestPersonalEnsureAlreadyProvisionedPredicate(t *testing.T) {
	pool := dbPool(t)
	ctx := context.Background()
	uid := seedUser(t, pool)
	now := time.Now().UTC()

	cfg, repo := testConfig(pool)
	require.NoError(t, pg.WithService(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		_, err := repo.CreatePersonalWorkspaceTx(ctx, tx, personalSlug(uid), uid, now)
		return err
	}), "first provisioning insert")

	err := pg.WithService(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		_, err := repo.CreatePersonalWorkspaceTx(ctx, tx, personalSlug(uid), uid, now)
		return err
	})
	require.Error(t, err, "second insert for the same owner must violate uq_workspace_personal")
	if !alreadyProvisioned(err) {
		t.Fatalf("duplicate insert must resolve to already-provisioned, got: %v", err)
	}

	// And end to end: ensure on top of a pre-provisioned state is a silent
	// no-op that leaves exactly one workspace.
	hooks := PersonalWorkspace(cfg)
	require.NoError(t, hooks.AfterRegister(ctx, uid))
	_, _, found := personalWorkspaceOf(t, pool, uid)
	require.True(t, found)
	require.Equal(t, 1, countOwnerMembers(t, pool, uid))
	n, total := countOnboardingGrants(t, pool, uid)
	require.Zero(t, n, "no credits granted when the workspace already existed")
	require.Zero(t, total)
}

// (e) quota GrantTx inserts once per refID — within one transaction and
// across transactions (the idempotency contract provisioning relies on).
func TestQuotaGrantTxIdempotentPerRefID(t *testing.T) {
	pool := dbPool(t)
	ctx := context.Background()
	uid := seedUser(t, pool)

	cfg, repo := testConfig(pool)
	qsvc := cfg.Quota
	now := time.Now().UTC()

	var wsID string
	require.NoError(t, pg.WithService(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		ws, err := repo.CreatePersonalWorkspaceTx(ctx, tx, personalSlug(uid), uid, now)
		if err != nil {
			return err
		}
		wsID = ws.ID

		unlocked, err := qsvc.GrantTx(ctx, tx, wsID, "tasks_monthly", "onboarding", wsID+":tasks_monthly", 5, now)
		require.NoError(t, err)
		require.True(t, unlocked, "first grant must insert")
		unlocked, err = qsvc.GrantTx(ctx, tx, wsID, "tasks_monthly", "onboarding", wsID+":tasks_monthly", 5, now)
		require.NoError(t, err)
		require.False(t, unlocked, "same-refID replay inside one tx must conflict-do-nothing")
		return nil
	}), "create personal workspace + grants")

	// Across transactions: the same refID stays silent, once per refID total.
	require.NoError(t, pg.WithService(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		unlocked, err := qsvc.GrantTx(ctx, tx, wsID, "tasks_monthly", "onboarding", wsID+":tasks_monthly", 5, now)
		require.NoError(t, err)
		require.False(t, unlocked)
		// A different refID is a different grant.
		unlocked, err = qsvc.GrantTx(ctx, tx, wsID, "tasks_monthly", "onboarding", wsID+":other", 7, now)
		require.NoError(t, err)
		require.True(t, unlocked)
		return nil
	}))

	var n int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM quota_grant WHERE workspace_id = $1 AND counter_key = 'tasks_monthly' AND reason = 'onboarding'`, wsID).Scan(&n))
	require.Equal(t, 2, n, "exactly one row per distinct refID")
}

// Backfill (audit §3.1): a credit key declared in Credits only AFTER the
// workspace was provisioned must be granted on the next login — with the
// same refID shape as the create-time grant, so the backfill is idempotent
// (second login does not double-grant) and the ledger is indistinguishable
// from a workspace provisioned with the full key list.
func TestPersonalEnsureBackfillsNewlyDeclaredCreditKey(t *testing.T) {
	pool := dbPool(t)
	ctx := context.Background()
	uid := seedUser(t, pool)

	// Provision under the OLD key list: workspace + tasks_monthly only.
	oldCfg, _ := testConfig(pool, Credit{Key: "tasks_monthly", Amount: 5})
	oldHooks := PersonalWorkspace(oldCfg)
	require.NoError(t, oldHooks.AfterRegister(ctx, uid))
	wsID, _, found := personalWorkspaceOf(t, pool, uid)
	require.True(t, found)

	// The product releases: migration lands, Credits grows themes_monthly
	// (the tool-site field report). Next login re-ensures under the new list.
	newCfg, _ := testConfig(pool,
		Credit{Key: "tasks_monthly", Amount: 5},
		Credit{Key: "themes_monthly", Amount: 5},
	)
	newHooks := PersonalWorkspace(newCfg)
	require.NoError(t, newHooks.AfterLogin(ctx, uid, "session-new-key"))

	// tasks_monthly not re-granted, themes_monthly backfilled once — with
	// the exact refID the create-time path would have used.
	var themesGrants int
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT count(*) FROM quota_grant
		WHERE workspace_id = $1 AND counter_key = 'themes_monthly'
		  AND reason = 'onboarding' AND ref_id = $2`,
		wsID, wsID+":themes_monthly").Scan(&themesGrants))
	require.Equal(t, 1, themesGrants, "missing key must be backfilled with the create-time refID")
	n, total := countOnboardingGrants(t, pool, uid)
	require.Equal(t, 2, n, "old key must not double-grant, new key must appear once")
	require.EqualValues(t, 10, total)

	// Second login: steady state, no further grants.
	require.NoError(t, newHooks.AfterLogin(ctx, uid, "session-steady"))
	require.NoError(t, newHooks.AfterRegister(ctx, uid))
	n, total = countOnboardingGrants(t, pool, uid)
	require.Equal(t, 2, n, "backfill must be idempotent")
	require.EqualValues(t, 10, total)

	// The backfilled grant is a REAL grant the quota formula counts: usage
	// math sees limit 0 + grants 5 - used 0 > 0, so the capability is usable
	// immediately (this is the 402 the field report was about).
	st, err := newCfg.Quota.Check(ctx, wsID, "themes_monthly", time.Now().UTC())
	require.NoError(t, err)
	require.EqualValues(t, 5, st.Granted)
	require.False(t, st.Exceeded(), "backfilled credit must clear the E_QUOTA_EXHAUSTED state")
}

// Backfill steady state: a workspace whose onboarding grants already cover
// every configured key is a pure no-op — one probe query, no new grants, no
// error.
func TestPersonalEnsureBackfillNoopWhenAllKeysGranted(t *testing.T) {
	pool := dbPool(t)
	ctx := context.Background()
	uid := seedUser(t, pool)

	cfg, _ := testConfig(pool,
		Credit{Key: "tasks_monthly", Amount: 5},
		Credit{Key: "themes_monthly", Amount: 5},
	)
	hooks := PersonalWorkspace(cfg)
	require.NoError(t, hooks.AfterRegister(ctx, uid))

	for i := 0; i < 2; i++ {
		require.NoError(t, hooks.AfterLogin(ctx, uid, fmt.Sprintf("s-%d", i)), "steady-state login %d must not error", i+1)
	}
	n, total := countOnboardingGrants(t, pool, uid)
	require.Equal(t, 2, n, "no extra grants on steady-state logins")
	require.EqualValues(t, 10, total)
}

// Backfill must not touch products running their own credit ledger: Credits
// empty behaves byte-for-byte as before — fast path returns after the
// workspace probe, zero quota queries, and a workspace with pre-existing
// (product-managed) grants keeps them untouched.
func TestPersonalEnsureBackfillSkippedWithoutCredits(t *testing.T) {
	pool := dbPool(t)
	ctx := context.Background()
	uid := seedUser(t, pool)

	// Provision with credits ONCE so a workspace exists, then simulate the
	// ledger-managing product: same user, Credits empty.
	withCredits, _ := testConfig(pool, Credit{Key: "tasks_monthly", Amount: 5})
	require.NoError(t, PersonalWorkspace(withCredits).AfterRegister(ctx, uid))
	_, _, found := personalWorkspaceOf(t, pool, uid)
	require.True(t, found)

	noCredits, _ := testConfig(pool)
	hooks := PersonalWorkspace(noCredits)
	require.NoError(t, hooks.AfterLogin(ctx, uid, "ledger-product"))
	n, total := countOnboardingGrants(t, pool, uid)
	require.Equal(t, 1, n, "Credits-empty ensure must not grant or revoke anything")
	require.EqualValues(t, 5, total)

	// And the same product from scratch: workspace + membership, no grants.
	uid2 := seedUser(t, pool)
	require.NoError(t, PersonalWorkspace(noCredits).AfterRegister(ctx, uid2))
	_, _, found = personalWorkspaceOf(t, pool, uid2)
	require.True(t, found)
	require.Equal(t, 1, countOwnerMembers(t, pool, uid2))
	n, total = countOnboardingGrants(t, pool, uid2)
	require.Zero(t, n)
	require.Zero(t, total)
}

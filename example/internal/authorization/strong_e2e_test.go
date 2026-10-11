package authorization

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/authorization"
	identitypg "github.com/haozing/ploykit/identity/adapters/pgrepo"
	identityapp "github.com/haozing/ploykit/identity/app"
	identitydomain "github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/platform/webx"
)

// strongEnv is the DB-backed e2e harness: real schema, real session store,
// real gate — only the guarded handler is a recorder, because the subject of
// these tests is the authorization layer, not the workspace domain.
type strongEnv struct {
	pool   *pgxpool.Pool
	db     *pg.DB
	repo   *identitypg.Repo
	strong *Strong

	authCfg webx.AuthConfig
	srv     http.Handler

	owner     string // user id
	member    string // user id
	ws        string // workspace id
	handlerOK atomic.Int32
}

func newStrongEnv(t *testing.T) *strongEnv {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	require.NoError(t, pgmigrate.Up(ctx, pool, migrations.FS, "."))

	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	t.Cleanup(db.Close)

	e := &strongEnv{
		pool:    pool,
		db:      db,
		repo:    identitypg.New(pool, identitypg.Config{}),
		authCfg: webx.DefaultAuthConfig(),
	}
	e.strong, err = New(db, e.authCfg, slog.New(slog.DiscardHandler))
	require.NoError(t, err)
	e.owner, e.member, e.ws = e.seed(ctx, t)
	return e
}

func (e *strongEnv) seed(ctx context.Context, t *testing.T) (owner, member, ws string) {
	t.Helper()
	// The hash satisfies the schema; no endpoint under test verifies a
	// password (the confirm-password step is simulated by stamping the
	// session directly).
	hash, err := identityapp.HashPassword("correct-horse-battery-staple")
	require.NoError(t, err)
	require.NoError(t, e.pool.QueryRow(ctx, `
		INSERT INTO "user" (email, display_name, password_hash) VALUES ($1, 'Owner', $2) RETURNING id`,
		"strong-owner-"+uuid.NewString()+"@example.test", hash).Scan(&owner))
	require.NoError(t, e.pool.QueryRow(ctx, `
		INSERT INTO "user" (email, display_name, password_hash) VALUES ($1, 'Member', $2) RETURNING id`,
		"strong-member-"+uuid.NewString()+"@example.test", hash).Scan(&member))
	require.NoError(t, e.pool.QueryRow(ctx, `
		INSERT INTO workspace (slug, name, created_by) VALUES ($1, 'Strong WS', $2) RETURNING id`,
		"strong-"+strings.ToLower(uuid.NewString()[:8]), owner).Scan(&ws))
	_, err = e.pool.Exec(ctx,
		`INSERT INTO member (workspace_id, user_id, role, created_by) VALUES ($1, $2, 'owner', $2), ($1, $3, 'member', $2)`,
		ws, owner, member)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = e.pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM member WHERE workspace_id = $1`, ws)
		_, _ = e.pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM workspace WHERE id = $1`, ws)
		_, _ = e.pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM "user" WHERE id IN ($1, $2)`, owner, member)
	})
	return owner, member, ws
}

// mount builds the request pipeline under test — Authenticate → strong gate →
// recorder — mirroring the wired composition. The outermost permission gate
// lives in the workspace adapter (covered there); here the strong middleware
// is the subject.
func (e *strongEnv) mount(t *testing.T) {
	t.Helper()
	e.handlerOK.Store(0)
	recorder := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		e.handlerOK.Add(1)
		w.WriteHeader(http.StatusOK)
	})
	m := webx.NewMux()
	m.Handle("DELETE /api/workspaces/{workspaceId}", e.strong.Middleware()(recorder))
	// the subroute form the real workspace adapter mounts behind StripPrefix
	sub := webx.NewMux()
	sub.Handle("POST /{workspaceId}/transfer-ownership", e.strong.Middleware()(recorder))
	m.Handle("POST /api/workspaces/{workspaceId}/", http.StripPrefix("/api/workspaces", sub))
	e.srv = webx.Authenticate(&e.authCfg, e.repo, e.repo)(m)
}

func (e *strongEnv) session(t *testing.T, userID string, passwordConfirmed bool) (token, sessionID string) {
	t.Helper()
	token, _, err := e.repo.CreateSession(context.Background(), webx.SessionCreate{
		UserID: userID, PasswordConfirmed: passwordConfirmed, Now: time.Now(),
	})
	require.NoError(t, err)
	p, err := e.repo.VerifySession(context.Background(), token, time.Now())
	require.NoError(t, err)
	require.NotNil(t, p, "session must verify right after creation")
	return token, p.SessionID
}

func (e *strongEnv) do(method, path, cookieToken string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if cookieToken != "" {
		req.AddCookie(&http.Cookie{Name: e.authCfg.CookieName, Value: cookieToken})
	}
	w := httptest.NewRecorder()
	e.srv.ServeHTTP(w, req)
	return w
}

// errorBody decodes the standard webx error envelope.
type errorBody struct {
	Code    string         `json:"error"`
	Message string         `json:"message"`
	Details map[string]any `json:"details"`
}

func decodeError(t *testing.T, w *httptest.ResponseRecorder) errorBody {
	t.Helper()
	var body errorBody
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body), "body: %s", w.Body.String())
	return body
}

// TestStrongChallengeConfirmRetry is ADR 0005 acceptance criterion 2:
// challenge → re-authentication → allow, and the retried request does not
// collide back into the same denial.
func TestStrongChallengeConfirmRetry(t *testing.T) {
	env := newStrongEnv(t)
	env.mount(t)
	ctx := context.Background()

	token, sessionID := env.session(t, env.owner, false)

	// 1. stale (never-confirmed) password → challenge, handler never runs
	w := env.do("DELETE", "/api/workspaces/"+env.ws, token)
	require.Equal(t, http.StatusForbidden, w.Code)
	body := decodeError(t, w)
	require.Equal(t, webx.CodeReauthRequired, body.Code)
	require.Equal(t, "workspace.delete", body.Details["target_operation"])
	require.Equal(t, "aal1", body.Details["required_assurance"])
	require.InDelta(t, 900.0, body.Details["max_age_seconds"], 0.01)
	require.Zero(t, env.handlerOK.Load(), "handler must not run behind a challenge")

	// 2. the confirm-password step: stamp the session (what POST
	// /auth/confirm-password does through SessionService.ConfirmPassword)
	require.NoError(t, env.repo.ConfirmSessionPassword(ctx, sessionID, time.Now()))

	// 3. retry → allow, exactly once — not re-denied
	w = env.do("DELETE", "/api/workspaces/"+env.ws, token)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	require.Equal(t, int32(1), env.handlerOK.Load())
}

// TestStrongTransferOwnershipSubroute covers the second operation of the
// named pair over the subroute shape the workspace adapter actually mounts.
func TestStrongTransferOwnershipSubroute(t *testing.T) {
	env := newStrongEnv(t)
	env.mount(t)
	ctx := context.Background()

	token, sessionID := env.session(t, env.owner, false)

	w := env.do("POST", "/api/workspaces/"+env.ws+"/transfer-ownership", token)
	require.Equal(t, http.StatusForbidden, w.Code)
	body := decodeError(t, w)
	require.Equal(t, webx.CodeReauthRequired, body.Code)
	require.Equal(t, "workspace.transfer_ownership", body.Details["target_operation"])

	require.NoError(t, env.repo.ConfirmSessionPassword(ctx, sessionID, time.Now()))
	w = env.do("POST", "/api/workspaces/"+env.ws+"/transfer-ownership", token)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
}

// TestStrongNonOwnerTerminalDenial pins ADR 0011's composition order in
// computed form over HTTP: the non-owner's stale password must NOT coax a
// challenge — the terminal role denial surfaces.
func TestStrongNonOwnerTerminalDenial(t *testing.T) {
	env := newStrongEnv(t)
	env.mount(t)

	token, _ := env.session(t, env.member, false)
	w := env.do("DELETE", "/api/workspaces/"+env.ws, token)
	require.Equal(t, http.StatusForbidden, w.Code)
	body := decodeError(t, w)
	require.Equal(t, authorization.DenialCodePermissionDenied, body.Code,
		"a non-owner must never receive the recoverable challenge")
	require.Equal(t, "role", body.Details["stage"])
	require.Equal(t, authorization.ReasonWorkspaceRoleNotAllowed, body.Details["reason"])
	require.Zero(t, env.handlerOK.Load())
}

// TestStrongFailClosedUnknownShape: a shape outside the closed set never
// reaches a handler. At the router layer the subtree rejects the method
// (405); shapes that DO reach the gate but resolve to no catalog operation
// get the guard's policy denial — pinned in TestStrongMiddlewareDenials.
func TestStrongFailClosedUnknownShape(t *testing.T) {
	env := newStrongEnv(t)
	env.mount(t)

	token, _ := env.session(t, env.owner, true)
	w := env.do("DELETE", "/api/workspaces/"+env.ws+"/members", token)
	require.Equal(t, http.StatusMethodNotAllowed, w.Code,
		"the router must close unknown shapes before the domain")

	// unauthenticated requests stay 401 at the gate
	w = env.do("DELETE", "/api/workspaces/"+env.ws, "")
	require.Equal(t, http.StatusUnauthorized, w.Code)
}

// TestStrongPATDenied pins the batch-1 transport assertion: a machine
// principal (PAT) gets the terminal denial, never a challenge — machines
// cannot reauthenticate interactively.
func TestStrongPATDenied(t *testing.T) {
	env := newStrongEnv(t)
	env.mount(t)
	ctx := context.Background()

	sum := sha256.Sum256([]byte(uuid.NewString()))
	raw := webx.DefaultPATPrefix + hex.EncodeToString(sum[:20])
	require.Len(t, strings.TrimPrefix(raw, webx.DefaultPATPrefix), 40)
	_, err := env.repo.CreatePAT(ctx, env.owner, "e2e", identitydomain.HashPAT(raw), webx.DefaultPATPrefix, nil, nil)
	require.NoError(t, err)

	req := httptest.NewRequest("DELETE", "/api/workspaces/"+env.ws, nil)
	req.Header.Set("Authorization", "Bearer "+raw)
	w := httptest.NewRecorder()
	env.srv.ServeHTTP(w, req)

	require.Equal(t, http.StatusForbidden, w.Code)
	body := decodeError(t, w)
	require.Equal(t, authorization.DenialCodePermissionDenied, body.Code,
		"a PAT must get the terminal denial, not a step-up challenge")
	require.Equal(t, "authentication", body.Details["stage"])
	require.Equal(t, authorization.ReasonAuthMethodNotAllowed, body.Details["reason"])
	require.Zero(t, env.handlerOK.Load())
}

// TestStrongTOCTOUInTxRevocation is the in-tx facts regression pin (G3):
// membership revoked inside the transaction flips the decision to deny in
// that same transaction — the gate reads through the caller's pgx.Tx.
func TestStrongTOCTOUInTxRevocation(t *testing.T) {
	env := newStrongEnv(t)
	env.mount(t)

	token, _ := env.session(t, env.owner, true)

	// baseline: fresh password + active membership → allow
	w := env.do("DELETE", "/api/workspaces/"+env.ws, token)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	require.Equal(t, int32(1), env.handlerOK.Load())

	// revoke the membership INSIDE a transaction and push the request through
	// with that transaction's context: the gate must see the uncommitted
	// revocation and deny (handler count unchanged).
	var code int
	var body errorBody
	err := env.db.Within(context.Background(), func(ctx context.Context) error {
		_, err := env.db.Tx(ctx).Exec(ctx,
			`UPDATE member SET removed_at = now() WHERE workspace_id = $1 AND user_id = $2`,
			env.ws, env.owner)
		if err != nil {
			return err
		}
		req := httptest.NewRequest("DELETE", "/api/workspaces/"+env.ws, nil).WithContext(ctx)
		req.AddCookie(&http.Cookie{Name: env.authCfg.CookieName, Value: token})
		rec := httptest.NewRecorder()
		env.srv.ServeHTTP(rec, req)
		code = rec.Code
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		return err
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusForbidden, code, "same-tx membership revocation must flip the decision")
	require.Equal(t, authorization.DenialCodePermissionDenied, body.Code)
	require.Equal(t, "membership", body.Details["stage"])
	require.Equal(t, authorization.ReasonWorkspaceMembershipInactive, body.Details["reason"])
	require.Equal(t, int32(1), env.handlerOK.Load(), "no handler run behind the denial")
}

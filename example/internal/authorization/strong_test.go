package authorization

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/authorization"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/stretchr/testify/require"
)

func mustParseCatalog(t *testing.T, raw string) authorization.Catalog {
	t.Helper()
	catalog, err := authorization.ParseCatalog([]byte(raw), authorization.NewRegistry())
	if err != nil {
		t.Fatalf("ParseCatalog: %v", err)
	}
	return catalog
}

// mustEmbeddedCatalog parses the shipped catalog.yaml without a database —
// the pure-catalog seam of the package.
func mustEmbeddedCatalog(t *testing.T) authorization.Catalog {
	t.Helper()
	raw, err := catalogFS.ReadFile("catalog.yaml")
	if err != nil {
		t.Fatal(err)
	}
	return mustParseCatalog(t, string(raw))
}

// newTestStrong assembles the gate without a pg.DB: resolver/catalog/evaluator
// wiring only. Facts never load in this configuration, so the DB-less Strong
// is safe for resolver and decision-logic tests.
func newTestStrong(t *testing.T) *Strong {
	t.Helper()
	catalog := mustEmbeddedCatalog(t)
	resolver := NewResolver()
	if err := resolver.Bind(catalog); err != nil {
		t.Fatalf("resolver.Bind: %v", err)
	}
	provider := NewTxFactsProvider(nil)
	eval, err := authorization.NewEvaluator(catalog, authorization.NewRegistry(), provider)
	if err != nil {
		t.Fatalf("NewEvaluator: %v", err)
	}
	return &Strong{eval: eval, resolver: resolver, provider: provider,
		cfg: webx.DefaultAuthConfig(), log: slog.New(slog.DiscardHandler), now: func() time.Time {
			return time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
		}}
}

func TestEmbeddedCatalogDeclaresTheNamedPair(t *testing.T) {
	// ADR 0005 names exactly this pair for the reference wiring; the catalog
	// must not silently grow beyond it without a decision (example weight is
	// capped by ADR 0013: the named pair + one AAL2-grade op).
	catalog := mustEmbeddedCatalog(t)
	if got := len(catalog.Operations); got != 3 {
		t.Fatalf("catalog declares %d operations, want 3 (delete + transfer_ownership + token.create)", got)
	}
	for _, opID := range []string{"workspace.delete", "workspace.transfer_ownership"} {
		op, ok := catalog.Operation(opID)
		if !ok {
			t.Fatalf("catalog is missing %q", opID)
		}
		if op.AuthMethod != authorization.AuthMethodSession ||
			op.Scope != authorization.ScopeKindWorkspacePath ||
			len(op.AllowedWorkspaceRoles) != 1 || op.AllowedWorkspaceRoles[0] != "owner" {
			t.Fatalf("%q misconfigured: %+v", opID, op)
		}
		if op.RecentAuth != authorization.RecentAuthPassword || op.RecentAuthWindowSeconds != 900 {
			t.Fatalf("%q recent-auth wiring drifted: %+v", opID, op)
		}
	}
	// the AAL2-grade op: PAT creation needs password AND mfa freshness
	token, ok := catalog.Operation("token.create")
	if !ok {
		t.Fatal("catalog is missing token.create")
	}
	if token.AuthMethod != authorization.AuthMethodSession ||
		token.Scope != authorization.ScopeKindPlatform ||
		token.Assurance != authorization.AssuranceAAL2 ||
		token.RecentAuth != authorization.RecentAuthPasswordAndMFA ||
		token.RecentAuthWindowSeconds != 900 ||
		len(token.AllowedWorkspaceRoles) != 0 {
		t.Fatalf("token.create misconfigured: %+v", token)
	}
}

// testNow is the shared decision clock; facts and windows in the tests are
// phrased relative to it.
var testNow = time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)

func testSessionPrincipal() authorization.SessionPrincipal {
	return authorization.SessionPrincipal{
		SubjectID:      "11111111-1111-1111-1111-111111111111",
		SessionID:      "22222222-2222-2222-2222-222222222222",
		AbsoluteExpiry: testNow.Add(time.Hour), IdleExpiry: testNow.Add(time.Hour),
	}
}

func ownerFacts(stale time.Duration) authorization.Facts {
	return authorization.Facts{
		ActiveUser: true, ActiveSession: true, ActiveWorkspaceMembership: true,
		WorkspaceRoles:   []string{"owner"},
		Assurance:        authorization.AssuranceAAL1,
		RecentPasswordAt: testNow.Add(-stale),
	}
}

// TestEvaluateTerminalOrderPinsComposition pins the computed form of ADR
// 0011's composition order on the example catalog: a stale-password owner is
// challenged, but behind a non-owner's challenge sits a terminal role denial
// that must surface instead.
func TestEvaluateTerminalOrderPinsComposition(t *testing.T) {
	strong := newTestStrong(t)
	opID := "workspace.delete"
	principal := testSessionPrincipal()
	scope := authorization.WorkspaceScope{WorkspaceID: "ws-1"}

	// owner with a 30-minute-old confirmation (window is 900s): challenge.
	decision, err := strong.evaluate(opID, principal, scope,
		ownerFacts(30*time.Minute), testNow)
	if err != nil {
		t.Fatal(err)
	}
	if decision.Outcome != authorization.OutcomeChallenge || decision.Challenge == nil {
		t.Fatalf("stale-password owner: %+v, want challenge", decision)
	}
	if decision.Challenge.TargetOperationID != opID ||
		decision.Challenge.MaxAge != 900*time.Second ||
		decision.Challenge.RequiredAssurance != authorization.AssuranceAAL1 {
		t.Fatalf("challenge payload drifted: %+v", decision.Challenge)
	}

	// the challenge is recoverable: forced-fresh facts let the owner through.
	terminal, err := strong.evaluate(opID, principal, scope,
		forcedFreshFacts(ownerFacts(30*time.Minute), testNow), testNow)
	if err != nil {
		t.Fatal(err)
	}
	if !terminal.Allowed() {
		t.Fatalf("forced-fresh owner must pass the remaining stages: %+v", terminal)
	}

	// plain member with the same stale confirmation: the naive decision is a
	// challenge (authentication stage runs first), but the terminal check
	// denies at the role stage — the middleware must project THAT.
	memberFacts := ownerFacts(30 * time.Minute)
	memberFacts.WorkspaceRoles = []string{"member"}
	naive, err := strong.evaluate(opID, principal, scope, memberFacts, testNow)
	if err != nil {
		t.Fatal(err)
	}
	if naive.Outcome != authorization.OutcomeChallenge {
		t.Fatalf("naive member decision: %+v, want challenge before the terminal check", naive)
	}
	terminal, err = strong.evaluate(opID, principal, scope,
		forcedFreshFacts(memberFacts, testNow), testNow)
	if err != nil {
		t.Fatal(err)
	}
	if terminal.Outcome != authorization.OutcomeDeny ||
		terminal.Stage != authorization.StageRole ||
		terminal.ReasonCode != authorization.ReasonWorkspaceRoleNotAllowed {
		t.Fatalf("terminal check must deny the non-owner at role stage: %+v", terminal)
	}
}

func TestForcedFreshFactsSatisfyEveryFreshnessRule(t *testing.T) {
	now := testNow
	facts := forcedFreshFacts(authorization.Facts{}, now)
	if facts.Assurance != authorization.AssuranceAAL2 ||
		facts.RecentPasswordAt != now || facts.RecentMFAAt != now {
		t.Fatalf("forced-fresh facts incomplete: %+v", facts)
	}
	// membership/role facts pass through untouched — the terminal check must
	// still see them.
	facts = forcedFreshFacts(ownerFacts(time.Minute), now)
	if !facts.ActiveWorkspaceMembership || len(facts.WorkspaceRoles) != 1 {
		t.Fatalf("forced-fresh facts dropped membership facts: %+v", facts)
	}
}

// compile-time: the concrete provider keeps satisfying the gate's seam.
var _ sessionFactsProvider = (*TxFactsProvider)(nil)

// TestStrongMiddlewareDenials pins the gate's pre-transaction denials over
// HTTP shapes without a database: unknown route shape (fail-closed policy
// denial) and non-session transport (terminal authentication denial).
func TestStrongMiddlewareDenials(t *testing.T) {
	strong := newTestStrong(t)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler must not run behind a denial")
	})
	gate := strong.Middleware()(next)

	sessionReq := func(method, path string) *http.Request {
		req := httptest.NewRequest(method, path, nil)
		req.AddCookie(&http.Cookie{Name: "tk_auth", Value: "sometoken"})
		return req.WithContext(webx.WithPrincipal(req.Context(), &webx.Principal{
			UserID: "u-1", SessionID: "s-1", Source: webx.SourceSession,
		}))
	}

	// unknown route shape → policy-stage fail-closed denial
	w := httptest.NewRecorder()
	gate.ServeHTTP(w, sessionReq("GET", "/api/workspaces/w1/members"))
	var body struct {
		Code    string         `json:"error"`
		Details map[string]any `json:"details"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Equal(t, http.StatusForbidden, w.Code)
	require.Equal(t, authorization.DenialCodePermissionDenied, body.Code)
	require.Equal(t, "policy", body.Details["stage"])
	require.Equal(t, authorization.ReasonUnknownOperationOrScope, body.Details["reason"])

	// PAT transport on a session-only operation → terminal authentication
	// denial, never a challenge
	patReq := httptest.NewRequest("DELETE", "/api/workspaces/w1", nil)
	patReq.Header.Set("Authorization", "Bearer tk_"+strings.Repeat("a", 40))
	w = httptest.NewRecorder()
	gate.ServeHTTP(w, patReq)
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Equal(t, http.StatusForbidden, w.Code)
	require.Equal(t, authorization.DenialCodePermissionDenied, body.Code)
	require.Equal(t, "authentication", body.Details["stage"])
	require.Equal(t, authorization.ReasonAuthMethodNotAllowed, body.Details["reason"])

	// cookie present but unresolved → 401 (credential did not verify)
	w = httptest.NewRecorder()
	gate.ServeHTTP(w, httptest.NewRequest("DELETE", "/api/workspaces/w1", nil).
		WithContext(webx.WithPrincipal(context.Background(), nil)))
	require.Equal(t, http.StatusUnauthorized, w.Code)

	// anonymous (no credential at all) → 401
	w = httptest.NewRecorder()
	gate.ServeHTTP(w, httptest.NewRequest("DELETE", "/api/workspaces/w1", nil))
	require.Equal(t, http.StatusUnauthorized, w.Code)

	// mixed transport (cookie + bearer) → 401 E_AUTH_TRANSPORT_CONFLICT,
	// before anything else forms an opinion
	mixed := httptest.NewRequest("DELETE", "/api/workspaces/w1", nil)
	mixed.AddCookie(&http.Cookie{Name: "tk_auth", Value: "sometoken"})
	mixed.Header.Set("Authorization", "Bearer tk_"+strings.Repeat("a", 40))
	w = httptest.NewRecorder()
	gate.ServeHTTP(w, mixed)
	require.Equal(t, http.StatusUnauthorized, w.Code)
	var conflict struct {
		Code string `json:"error"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &conflict))
	require.Equal(t, webx.CodeAuthTransportConflict, conflict.Code)
}

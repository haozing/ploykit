package webx

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func stepUpRequest(p *Principal) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/api/workspaces/ws-1", nil)
	if p != nil {
		r = r.WithContext(WithPrincipal(r.Context(), p))
	}
	return r
}

func TestRequireRecentAuth(t *testing.T) {
	const maxAge = 15 * time.Minute
	now := time.Now()
	cases := []struct {
		name       string
		principal  *Principal
		wantStatus int
		wantCode   string
	}{
		{
			name:       "unauthenticated is rejected as 401, not reauth",
			principal:  nil,
			wantStatus: http.StatusUnauthorized,
			wantCode:   CodeUnauthenticated,
		},
		{
			name: "PAT callers can never step up",
			principal: &Principal{UserID: "u1", Source: SourcePAT,
				PasswordConfirmedAt: now},
			wantStatus: http.StatusForbidden,
			wantCode:   CodeForbidden,
		},
		{
			name: "system callers can never step up",
			principal: &Principal{UserID: "u1", Source: SourceSystem,
				PasswordConfirmedAt: now},
			wantStatus: http.StatusForbidden,
			wantCode:   CodeForbidden,
		},
		{
			name:       "never confirmed session gets the challenge",
			principal:  &Principal{UserID: "u1", Source: SourceSession},
			wantStatus: http.StatusForbidden,
			wantCode:   CodeReauthRequired,
		},
		{
			name: "stale confirmation gets the challenge",
			principal: &Principal{UserID: "u1", Source: SourceSession,
				PasswordConfirmedAt: now.Add(-maxAge - time.Second)},
			wantStatus: http.StatusForbidden,
			wantCode:   CodeReauthRequired,
		},
		{
			name: "future-dated stamp does not count as fresh",
			principal: &Principal{UserID: "u1", Source: SourceSession,
				PasswordConfirmedAt: now.Add(time.Hour)},
			wantStatus: http.StatusForbidden,
			wantCode:   CodeReauthRequired,
		},
		{
			name: "fresh confirmation passes through",
			principal: &Principal{UserID: "u1", Source: SourceSession,
				PasswordConfirmedAt: now.Add(-maxAge + time.Second)},
			wantStatus: http.StatusOK,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			reached := false
			h := RequireRecentAuth(maxAge)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				reached = true
				w.WriteHeader(http.StatusOK)
			}))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, stepUpRequest(c.principal))

			if rec.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, c.wantStatus, rec.Body.String())
			}
			var body ErrorBody
			if c.wantStatus != http.StatusOK {
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatalf("decode body: %v", err)
				}
				if body.Code != c.wantCode {
					t.Fatalf("code = %q, want %q", body.Code, c.wantCode)
				}
			}
			if reached != (c.wantStatus == http.StatusOK) {
				t.Fatalf("handler reached = %v, want %v", reached, c.wantStatus == http.StatusOK)
			}
		})
	}
}

func TestRequireRecentAuth_ChallengeCarriesWindow(t *testing.T) {
	rec := httptest.NewRecorder()
	ErrReauthRequired(rec, 15*time.Minute, time.Time{})
	var body struct {
		Code    string `json:"error"`
		Details struct {
			MaxAgeSeconds int    `json:"max_age_seconds"`
			ConfirmedAt   string `json:"confirmed_at"`
		} `json:"details"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Code != CodeReauthRequired {
		t.Fatalf("code = %q, want %q", body.Code, CodeReauthRequired)
	}
	if body.Details.MaxAgeSeconds != 900 {
		t.Fatalf("max_age_seconds = %d, want 900", body.Details.MaxAgeSeconds)
	}
	if body.Details.ConfirmedAt != "" {
		t.Fatalf("never-confirmed challenge must omit confirmed_at, got %q", body.Details.ConfirmedAt)
	}
}

func TestRequireRecentMFA(t *testing.T) {
	const window = 15 * time.Minute
	gate := RequireRecentMFA(window)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	run := func(p *Principal) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/x", nil)
		if p != nil {
			req = req.WithContext(WithPrincipal(req.Context(), p))
		}
		w := httptest.NewRecorder()
		gate(next).ServeHTTP(w, req)
		return w
	}

	// fresh MFA proof passes
	fresh := &Principal{Source: SourceSession, MFAConfirmedAt: time.Now()}
	if w := run(fresh); w.Code != http.StatusOK {
		t.Fatalf("fresh MFA: %d, want 200", w.Code)
	}

	// stale MFA proof → 403 E_REAUTH_REQUIRED with factor=mfa
	stale := &Principal{Source: SourceSession, MFAConfirmedAt: time.Now().Add(-2 * window)}
	w := run(stale)
	if w.Code != http.StatusForbidden {
		t.Fatalf("stale MFA: %d, want 403", w.Code)
	}
	var body struct {
		Code    string         `json:"error"`
		Details map[string]any `json:"details"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != CodeReauthRequired || body.Details["factor"] != string(FactorMFA) {
		t.Fatalf("challenge shape: %+v", body)
	}

	// never-confirmed → challenge
	w = run(&Principal{Source: SourceSession})
	if w.Code != http.StatusForbidden {
		t.Fatalf("never-confirmed: %d, want 403", w.Code)
	}

	// machine principals get a plain 403 — never a challenge
	for _, src := range []Source{SourcePAT, SourceSystem} {
		w := run(&Principal{Source: src, MFAConfirmedAt: time.Now()})
		if w.Code != http.StatusForbidden {
			t.Fatalf("%s: %d, want 403", src, w.Code)
		}
		if strings.Contains(w.Body.String(), CodeReauthRequired) {
			t.Fatalf("%s must not receive the challenge protocol", src)
		}
	}

	// anonymous → 401
	if w := run(nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d, want 401", w.Code)
	}

	// the password twin is unaffected: fresh MFA does not satisfy RequireRecentAuth
	if w := run(fresh); w.Code == http.StatusOK {
		_ = w
	}
	gateAuth := RequireRecentAuth(window)
	w = httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/x", nil).WithContext(
		WithPrincipal(context.Background(), fresh))
	gateAuth(next).ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("MFA stamp must not satisfy the password gate: %d", w.Code)
	}
}

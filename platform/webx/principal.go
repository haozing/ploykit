package webx

import (
	"context"
	"net/http"
	"strings"
	"time"
)

type Source string

const (
	SourceSession Source = "session"
	SourcePAT     Source = "pat"
	SourceSystem  Source = "system"
)

type ProjectScope struct {
	ID string

	Role string
}

type CredentialScope struct {
	WorkspaceIDs []string `json:"workspace_ids,omitempty"`

	Permissions []string `json:"permissions,omitempty"`
}

func (s *CredentialScope) AllowsWorkspace(workspaceID string) bool {
	if s == nil || s.WorkspaceIDs == nil {
		return true
	}
	for _, id := range s.WorkspaceIDs {
		if id == workspaceID {
			return true
		}
	}
	return false
}

func (s *CredentialScope) AllowsPermission(perm string) bool {
	if s == nil || s.Permissions == nil {
		return true
	}
	dom := permDomain(perm)
	for _, p := range s.Permissions {
		if p == perm {
			return true
		}
		if d, ok := strings.CutSuffix(p, ":*"); ok && d == dom {
			return true
		}
	}
	return false
}

// Allows reports whether the scope covers ALL of the required permissions
// (same per-permission semantics as AllowsPermission; nil Permissions =
// unrestricted). The default enforcement gate for machine-facing mounts:
// webx.RequireScope(required...) is exactly `p.Scope.Allows(required...)`.
func (s *CredentialScope) Allows(required ...string) bool {
	for _, perm := range required {
		if !s.AllowsPermission(perm) {
			return false
		}
	}
	return true
}

func permDomain(perm string) string {
	if i := strings.IndexByte(perm, ':'); i > 0 {
		return perm[:i]
	}
	return perm
}

type Principal struct {
	UserID      string
	Email       string
	Name        string
	Source      Source
	SessionID   string
	PATID       string
	WorkspaceID string
	Role        string

	Project *ProjectScope

	Scope *CredentialScope

	AgentID string

	IsPlatformAdmin bool

	ImpersonatedBy string

	// PasswordConfirmedAt records when the caller last proved the password for
	// this session: a password login / registration / password change births
	// the session already confirmed, and POST /auth/confirm-password (step-up)
	// re-stamps it later. Zero = never proved (code login, third-party login,
	// impersonation, PAT). Consumed by RequireRecentAuth.
	PasswordConfirmedAt time.Time
}

// PasswordConfirmedWithin reports whether the password confirmation is fresh
// enough for a step-up window of maxAge (never-confirmed and future-dated
// stamps both fail).
func (p *Principal) PasswordConfirmedWithin(maxAge time.Duration, now time.Time) bool {
	at := p.PasswordConfirmedAt
	return !at.IsZero() && !at.After(now) && !at.Before(now.Add(-maxAge))
}

type principalKey struct{}

func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

func PrincipalFrom(ctx context.Context) *Principal {
	p, _ := ctx.Value(principalKey{}).(*Principal)
	return p
}

func PrincipalFromRequest(r *http.Request) *Principal { return PrincipalFrom(r.Context()) }

func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if PrincipalFromRequest(r) == nil {
			ErrUnauthenticated(w, "authentication required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func RequireHuman(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := PrincipalFromRequest(r)
		if p == nil {
			ErrUnauthenticated(w, "authentication required")
			return
		}
		if p.Source != SourceSession {
			ErrForbidden(w, "human session required")
			return
		}
		next(w, r)
	}
}

func RequestID(r *http.Request) string {
	if id := RequestIDFromCtx(r.Context()); id != "" {
		return id
	}
	return r.Header.Get(HeaderRequestID)
}

func P(fn func(w http.ResponseWriter, r *http.Request, p *Principal)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := PrincipalFromRequest(r)
		if p == nil {
			ErrUnauthenticated(w, "authentication required")
			return
		}
		fn(w, r, p)
	}
}

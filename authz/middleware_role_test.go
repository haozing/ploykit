package authz

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/haozing/ploykit/platform/webx"
)

// An empty principal role means the mount never resolved roles (RoleOf /
// member-path wiring). The denial must be diagnosable, not shaped exactly
// like a real permission failure (orkome field report #2: one full A/B
// environment bisect was spent telling those two apart).
func TestEmptyRoleDenialIsUnresolvedNotForbidden(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	defer slog.SetDefault(prev)

	a := New(nil, nil)
	h := Require(a, "workspace:delete")(
		func(w http.ResponseWriter, r *http.Request) { t.Error("handler must not run") },
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, wrapPrincipal(principal("", "ws1", false)))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	var body struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body not an error envelope: %v", err)
	}
	if body.Error != "E_ROLE_UNRESOLVED" {
		t.Fatalf("error code = %q, want E_ROLE_UNRESOLVED (body: %s)", body.Error, rec.Body.String())
	}
	if !strings.Contains(body.Message, "not wired") {
		t.Fatalf("message should point at the wiring, got %q", body.Message)
	}
	if !strings.Contains(buf.String(), "role middleware") {
		t.Fatalf("expected the once-per-process WARN on the default logger, got: %s", buf.String())
	}

	// A real role still denies with the plain Forbidden shape.
	rec2 := httptest.NewRecorder()
	h2 := Require(a, "workspace:delete")(
		func(w http.ResponseWriter, r *http.Request) { t.Error("handler must not run") },
	)
	h2.ServeHTTP(rec2, wrapPrincipal(principal(RoleMember, "ws1", false)))
	var body2 struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &body2); err != nil {
		t.Fatalf("body not an error envelope: %v", err)
	}
	if body2.Error == "E_ROLE_UNRESOLVED" {
		t.Fatal("a role-carrying principal must not be reported as role-unresolved")
	}
}

func wrapPrincipal(p *webx.Principal) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/x", nil)
	return r.WithContext(webx.WithPrincipal(r.Context(), p))
}

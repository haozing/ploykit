// Package legalhttp mounts the legal module's HTTP surface: the logged-in
// re-acceptance endpoint and the platform-admin acceptance-history /
// compliance endpoints. Products call Mount + MountAdmin from main.go —
// the same shape as billinghttp (user routes ride the global middleware
// chain; admin routes take the injected platform-admin guard).
package legalhttp

import (
	"net/http"

	"github.com/haozing/ploykit/legal"
	"github.com/haozing/ploykit/platform/webx"
)

// Deps carries the user-facing surface. Svc is required.
type Deps struct {
	Svc *legal.Service
}

// Mount wires the logged-in legal endpoints. Every route is behind the
// global Authenticate chain; webx.P rejects anonymous callers with 401.
// A nil Svc panics — same fail-fast wiring contract as AdminDeps.Guard
// below: a nil-service handler would only blow up on the first request,
// long after the wiring mistake was cheap to fix.
func Mount(mux webx.Router, d Deps) {
	if d.Svc == nil {
		panic("legalhttp: Deps.Svc is required (legal.Wire(...).Service())")
	}
	mux.HandleFunc("POST /api/legal/acceptances", webx.P(d.reaccept))
}

// AdminDeps mounts the operator-facing legal endpoints. Guard is the
// platform-admin middleware — pass adminhttp.PlatformAdminGuard(); a nil
// Guard panics (an unguarded admin route is a security hole, not a degraded
// feature — same discipline as billinghttp/settingshttp AdminDeps).
type AdminDeps struct {
	Mod   *legal.Module
	Svc   *legal.Service
	Guard func(http.Handler) http.Handler
}

// MountAdmin wires the admin legal endpoints (acceptance history lookup for
// disputes, compliance reconciliation for the admin card).
func MountAdmin(mux webx.Router, d AdminDeps) {
	if d.Guard == nil {
		panic("legalhttp: AdminDeps.Guard is required (platform admin closure, e.g. adminhttp.PlatformAdminGuard())")
	}
	if d.Mod != nil {
		mux.Handle("GET /api/admin/legal/compliance", d.Guard(http.HandlerFunc(d.compliance)))
	}
	if d.Svc != nil {
		mux.Handle("GET /api/admin/legal/acceptances", d.Guard(http.HandlerFunc(d.acceptancesByUser)))
	}
}

// reaccept records an explicit re-acceptance of a doc's current version
// (method=reaccept) — the endpoint behind a future material-change banner;
// it is cheap and ships in P0, the banner UI itself is P2 (audit L8).
func (d Deps) reaccept(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var body struct {
		DocKey string `json:"doc_key"`
	}
	if !webx.DecodeJSON(w, r, &body) {
		return
	}
	if err := d.Svc.Reaccept(r.Context(), p, body.DocKey); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (d AdminDeps) compliance(w http.ResponseWriter, r *http.Request) {
	webx.WriteJSON(w, http.StatusOK, d.Mod.Compliance(r.Context()))
}

func (d AdminDeps) acceptancesByUser(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	items, err := d.Svc.AcceptancesByUser(r.Context(), userID)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

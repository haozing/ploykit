package audithttp

import (
	"bytes"
	"net/http"
	"strconv"
	"time"

	"github.com/haozing/ploykit/audit"
	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
)

type Deps struct {
	Rec *audit.Recorder

	WsMW func(http.Handler) http.Handler

	Authz *authz.Authorizer
}

func Mount(mux *http.ServeMux, d Deps) {
	mux.Handle("GET /api/audit", d.ws(webx.P(d.list)))
	mux.Handle("GET /api/audit/export.csv", d.ws(webx.P(d.export)))
}

func (d Deps) ws(h http.Handler) http.Handler {
	if d.WsMW != nil {
		return d.WsMW(h)
	}
	return h
}

func (d Deps) canRead(p *webx.Principal) bool {
	if d.Authz != nil {
		return d.Authz.Can(p, "audit:read")
	}
	return p.Role == "owner" || p.Role == "admin"
}

func (d Deps) guard(w http.ResponseWriter, p *webx.Principal) bool {
	if p.WorkspaceID == "" {
		webx.ErrUnauthenticated(w, "workspace context required")
		return false
	}
	if !d.canRead(p) {
		webx.ErrForbidden(w, "audit:read permission required")
		return false
	}
	return true
}

func parseQuery(w http.ResponseWriter, r *http.Request) (audit.ListQuery, bool) {
	q := audit.ListQuery{
		ActorID:      r.URL.Query().Get("actor_id"),
		Action:       r.URL.Query().Get("action"),
		ResourceType: r.URL.Query().Get("resource_type"),
	}
	for _, s := range []struct {
		name string
		dst  *int
	}{
		{"limit", &q.Limit},
		{"offset", &q.Offset},
	} {
		if v := r.URL.Query().Get(s.name); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil {
				webx.ErrValidation(w, s.name+" must be an integer")
				return q, false
			}
			*s.dst = n
		}
	}
	for _, s := range []struct {
		name string
		dst  **time.Time
	}{
		{"from", &q.From},
		{"to", &q.To},
	} {
		if v := r.URL.Query().Get(s.name); v != "" {
			t, err := time.Parse(time.RFC3339, v)
			if err != nil {
				webx.ErrValidation(w, s.name+" must be RFC3339 (e.g. 2026-10-05T00:00:00Z)")
				return q, false
			}
			*s.dst = &t
		}
	}
	return q, true
}

func (d Deps) list(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if !d.guard(w, p) {
		return
	}
	q, ok := parseQuery(w, r)
	if !ok {
		return
	}
	q.WorkspaceID = p.WorkspaceID
	items, total, err := d.Rec.Query(r.Context(), q)
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

func (d Deps) export(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if !d.guard(w, p) {
		return
	}
	q, ok := parseQuery(w, r)
	if !ok {
		return
	}
	q.WorkspaceID = p.WorkspaceID

	var buf bytes.Buffer
	if err := d.Rec.ExportCSV(r.Context(), q, &buf); err != nil {
		webx.ErrInternal(w)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition",
		`attachment; filename="audit-`+p.WorkspaceID+`-`+time.Now().UTC().Format("20060102")+`.csv"`)
	_, _ = w.Write(buf.Bytes())
}

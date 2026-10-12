package devx

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/haozing/ploykit/platform/webx"
)

// ScopeObserve gates read-only dev endpoints (logs, job list/get, doctor);
// ScopeOperate gates mutating ones (job retry/cancel). Both follow the PAT
// scope model (webx.CredentialScope): non-PAT principals (browser sessions)
// pass untouched, PATs must carry the scope.
const (
	ScopeObserve  = "dev:observe"
	ScopeOperate  = "dev:operate"
	scopeAllScope = ScopeObserve
)

// AuditHook is the optional audit sink for mutating dev operations. It is a
// hook, not an import: platform packages cannot reach the audit domain, so
// the product injects its Auditor here (mounted endpoints do not auto-audit).
type AuditHook func(r *http.Request, action, target string)

// Deps wires the dev surface.
type Deps struct {
	// Logs serves /dev/logs. Optional; nil → endpoint reports not enabled.
	Logs *LogService
	// Jobs serves /dev/jobs. Optional; nil → endpoints report not wired.
	Jobs *JobService
	// Doctor serves /dev/doctor. Required for that endpoint; nil → not found.
	Doctor *Doctor
	// Audit, when set, records mutating operations (retry/cancel).
	Audit AuditHook
	// Log is used for the platform's own operational lines (mount, denials).
	Log *slog.Logger
}

// Mount registers the dev endpoints on the router (webx.Mux or a plain
// *http.ServeMux — both satisfy webx.Router):
//
//	GET  /dev/logs?request_id=&level=&limit=
//	GET  /dev/jobs?state=&queue=&kind=&limit=
//	GET  /dev/jobs/{id}
//	POST /dev/jobs/{id}/retry
//	POST /dev/jobs/{id}/cancel
//	GET  /dev/doctor
//
// Auth is NOT applied here — mount behind webx.Authenticate +
// webx.RequireScope(ScopeObserve / ScopeOperate) so PAT callers are scoped.
// The intended wiring gates the whole /dev/ prefix at observe level and
// re-gates the mutating subset at operate level.
func Mount(mux webx.Router, deps Deps) {
	observe := webx.RequireScope(ScopeObserve)
	operate := webx.RequireScope(ScopeOperate)

	mux.Handle("GET /dev/logs", observe(http.HandlerFunc(deps.handleLogs)))
	mux.Handle("GET /dev/jobs", observe(http.HandlerFunc(deps.handleJobList)))
	mux.Handle("GET /dev/jobs/{id}", observe(http.HandlerFunc(deps.handleJobGet)))
	mux.Handle("POST /dev/jobs/{id}/retry", operate(http.HandlerFunc(deps.handleJobRetry)))
	mux.Handle("POST /dev/jobs/{id}/cancel", operate(http.HandlerFunc(deps.handleJobCancel)))
	mux.Handle("GET /dev/doctor", observe(http.HandlerFunc(deps.handleDoctor)))
}

func (d *Deps) audit(r *http.Request, action, target string) {
	if d.Audit != nil {
		d.Audit(r, action, target)
	}
}

func jobIDFromPath(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func (d *Deps) handleJobList(w http.ResponseWriter, r *http.Request) {
	if d.Jobs == nil || !d.Jobs.Available() {
		webx.ErrNotFound(w, "job inspection not enabled (events not wired)")
		return
	}
	q := r.URL.Query()
	jobs, err := d.Jobs.List(r.Context(), q.Get("state"), q.Get("queue"), q.Get("kind"), atoiDefault(q.Get("limit"), 50))
	if err != nil {
		writeServiceErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"jobs": jobs})
}

func (d *Deps) handleJobGet(w http.ResponseWriter, r *http.Request) {
	id, ok := jobIDFromPath(r)
	if !ok {
		webx.ErrValidation(w, "invalid job id")
		return
	}
	if d.Jobs == nil || !d.Jobs.Available() {
		webx.ErrNotFound(w, "job inspection not enabled (events not wired)")
		return
	}
	job, err := d.Jobs.Get(r.Context(), id)
	if err != nil {
		writeServiceErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, job)
}

func (d *Deps) handleJobRetry(w http.ResponseWriter, r *http.Request) {
	id, ok := jobIDFromPath(r)
	if !ok {
		webx.ErrValidation(w, "invalid job id")
		return
	}
	if d.Jobs == nil || !d.Jobs.Available() {
		webx.ErrNotFound(w, "job operations not enabled (events not wired)")
		return
	}
	if err := d.Jobs.Retry(r.Context(), id); err != nil {
		writeServiceErr(w, err)
		return
	}
	d.audit(r, "devx.job.retry", strconv.FormatInt(id, 10))
	webx.WriteJSON(w, http.StatusOK, map[string]any{"id": id, "action": "retry"})
}

func (d *Deps) handleJobCancel(w http.ResponseWriter, r *http.Request) {
	id, ok := jobIDFromPath(r)
	if !ok {
		webx.ErrValidation(w, "invalid job id")
		return
	}
	if d.Jobs == nil || !d.Jobs.Available() {
		webx.ErrNotFound(w, "job operations not enabled (events not wired)")
		return
	}
	if err := d.Jobs.Cancel(r.Context(), id); err != nil {
		writeServiceErr(w, err)
		return
	}
	d.audit(r, "devx.job.cancel", strconv.FormatInt(id, 10))
	webx.WriteJSON(w, http.StatusOK, map[string]any{"id": id, "action": "cancel"})
}

func (d *Deps) handleDoctor(w http.ResponseWriter, r *http.Request) {
	if d.Doctor == nil {
		webx.ErrNotFound(w, "doctor not configured")
		return
	}
	webx.WriteJSON(w, http.StatusOK, d.Doctor.RunDoctor(r.Context(), 0))
}

// writeServiceErr maps JobService sentinel errors to HTTP statuses once.
func writeServiceErr(w http.ResponseWriter, err error) {
	switch {
	case err == nil:
		return
	case err == ErrJobNotFound:
		webx.ErrNotFound(w, err.Error())
	case err == ErrNotWired:
		webx.ErrNotFound(w, err.Error())
	default:
		if isValidationErr(err) {
			webx.ErrValidation(w, err.Error())
			return
		}
		webx.ErrInternal(w)
	}
}

func isValidationErr(err error) bool {
	for e := err; e != nil; {
		if e == ErrValidation {
			return true
		}
		u, ok := e.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		e = u.Unwrap()
	}
	return false
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

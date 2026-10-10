package schedulehttp

import (
	"errors"
	"net/http"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/schedule"
)

type Deps struct {
	Service *schedule.Service

	Guard func(http.Handler) http.Handler
}

func Mount(mux webx.Router, d Deps) {
	g := d.Guard
	if g == nil {
		g = func(h http.Handler) http.Handler { return h }
	}
	mux.Handle("GET /api/schedules", g(webx.P(d.list)))
	mux.Handle("POST /api/schedules", g(webx.P(d.create)))
	mux.Handle("PATCH /api/schedules/{id}", g(webx.P(d.update)))
	mux.Handle("DELETE /api/schedules/{id}", g(webx.P(d.del)))
	mux.Handle("POST /api/schedules/preview", g(webx.P(d.preview)))
}

func (d Deps) ws(w http.ResponseWriter, p *webx.Principal) string {
	if p.WorkspaceID == "" {
		webx.ErrValidation(w, "workspace context required (X-Workspace-Id)")
		return ""
	}
	return p.WorkspaceID
}

func (d Deps) list(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	wsID := d.ws(w, p)
	if wsID == "" {
		return
	}
	items, err := d.Service.List(r.Context(), wsID)
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (d Deps) create(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	wsID := d.ws(w, p)
	if wsID == "" {
		return
	}
	var in schedule.CreateInput
	if !webx.DecodeJSON(w, r, &in) {
		return
	}
	plan, err := d.Service.Create(r.Context(), wsID, in)
	if err != nil {
		d.writeDomainErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusCreated, plan)
}

func (d Deps) update(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	wsID := d.ws(w, p)
	if wsID == "" {
		return
	}
	var in schedule.UpdateInput
	if !webx.DecodeJSON(w, r, &in) {
		return
	}
	plan, err := d.Service.Update(r.Context(), wsID, r.PathValue("id"), in)
	if err != nil {
		d.writeDomainErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, plan)
}

func (d Deps) del(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	wsID := d.ws(w, p)
	if wsID == "" {
		return
	}
	if err := d.Service.Delete(r.Context(), wsID, r.PathValue("id")); err != nil {
		d.writeDomainErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) preview(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var in struct {
		CronExpr string `json:"cron_expr"`
		Timezone string `json:"timezone"`
		Count    int    `json:"count"`
	}
	if !webx.DecodeJSON(w, r, &in) {
		return
	}

	times, err := d.Service.Preview(r.Context(), in.CronExpr, in.Timezone, in.Count)
	if err != nil {
		d.writeDomainErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": times})
}

func (d Deps) writeDomainErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, schedule.ErrInvalidCron):
		webx.WriteError(w, http.StatusBadRequest, "E_INVALID_CRON", "invalid cron expression (expect 5 fields: minute hour day month weekday)", nil)
	case errors.Is(err, schedule.ErrInvalidTZ):
		webx.WriteError(w, http.StatusBadRequest, "E_INVALID_TZ", "invalid timezone (expect IANA name, e.g. Asia/Shanghai)", nil)
	case errors.Is(err, schedule.ErrInvalidKind):
		webx.WriteError(w, http.StatusBadRequest, "E_VALIDATION", err.Error(), nil)
	case errors.Is(err, schedule.ErrNotFound):
		webx.ErrNotFound(w, "schedule plan not found")
	case errors.Is(err, schedule.ErrBadMisfire):
		webx.ErrValidation(w, err.Error())
	default:
		webx.ErrInternal(w)
	}
}

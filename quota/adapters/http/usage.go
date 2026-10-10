package quotahttp

import (
	"context"
	"log/slog"
	"net/http"
	"sort"
	"time"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/quota"
)

type Deps struct {
	Svc *quota.Service

	WsMW func(http.Handler) http.Handler

	Authz *authz.Authorizer

	AccountScopedDims map[string]AccountUsageFunc
}

type AccountUsageFunc func(ctx context.Context, userID string) (int64, error)

func Mount(mux webx.Router, d Deps) {
	h := http.Handler(webx.P(d.usage))
	if d.WsMW != nil {
		h = d.WsMW(h)
	}
	mux.Handle("GET /api/usage", h)
}

func (d Deps) usage(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if p.WorkspaceID == "" {
		webx.ErrUnauthenticated(w, "workspace context required")
		return
	}

	if d.Authz != nil && !d.Authz.Can(p, "usage:read") &&
		p.Role != "owner" && p.Role != "admin" && p.Role != "member" {
		webx.ErrForbidden(w, "usage:read permission required")
		return
	}
	limits, planCode, err := d.Svc.LimitsFor(r.Context(), p.WorkspaceID)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	now := time.Now().UTC()
	keys := make([]string, 0, len(limits))
	for k := range limits {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	items := make([]quota.Status, 0, len(keys))
	for _, k := range keys {

		if resolve, ok := d.AccountScopedDims[k]; ok {
			used, err := resolve(r.Context(), p.UserID)
			if err != nil {
				webx.WriteErr(w, err)
				return
			}
			items = append(items, quota.Status{
				Key: k, Limit: limits[k], Used: used, Period: quota.Period(now),
			})
			continue
		}
		st, err := d.Svc.Check(r.Context(), p.WorkspaceID, k, now)
		if err != nil {
			webx.WriteErr(w, err)
			return
		}
		items = append(items, st)
	}

	if briefs, err := d.Svc.ActiveReservations(r.Context(), p.WorkspaceID, quota.Period(now)); err != nil {
		slog.Warn("quota usage reservations detail unavailable", "workspace", p.WorkspaceID, "err", err)
	} else {
		for i := range items {
			if bs := briefs[items[i].Key]; len(bs) > 0 {
				items[i].Reservations = bs
			}
		}
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{
		"workspace_id": p.WorkspaceID,
		"plan_code":    planCode,
		"period":       quota.Period(now),
		"items":        items,
	})
}

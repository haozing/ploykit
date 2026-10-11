package webx

import (
	"log/slog"
	"net/http"
)

type ConfigDeps struct {
	OAuthProviders  func() []string
	BillingChannels func() []string

	Extra func() map[string]any
}

func ConfigHandler(d ConfigDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// F20: a masked token comes back empty exactly when this request did
		// not pass through the CSRF middleware — a wiring omission on the
		// product's main chain. Serving `csrf_token: ""` silently pushes the
		// failure to the frontend ("CSRF bootstrap: response missing
		// csrf_token", every write then 403s); answering loudly here names
		// the missing middleware at the exact spot it is missing.
		token := CSRFMaskedToken(r)
		if token == "" {
			slog.Error("webx: /config served without CSRF middleware on the chain — mount CSRFConditional upstream of ConfigHandler",
				"path", r.URL.Path, "request_id", RequestIDFromCtx(r.Context()))
			WriteError(w, http.StatusInternalServerError, CodeInternal,
				"csrf middleware missing from the chain: /config cannot mint a token; mount webx.CSRFConditional upstream", nil)
			return
		}
		body := map[string]any{
			"csrf_token":       token,
			"oauth_providers":  nonEmptyStrings(d.OAuthProviders),
			"billing_channels": nonEmptyStrings(d.BillingChannels),
		}

		if d.Extra != nil {
			for k, v := range d.Extra() {
				body[k] = v
			}
		}
		WriteJSON(w, http.StatusOK, body)
	}
}

func nonEmptyStrings(f func() []string) []string {
	if f == nil {
		return []string{}
	}
	if s := f(); s != nil {
		return s
	}
	return []string{}
}

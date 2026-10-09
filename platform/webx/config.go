package webx

import "net/http"

type ConfigDeps struct {
	OAuthProviders  func() []string
	BillingChannels func() []string

	Extra func() map[string]any
}

func ConfigHandler(d ConfigDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body := map[string]any{
			"csrf_token":       CSRFMaskedToken(r),
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

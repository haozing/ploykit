package webx

import (
	"net/http"
	"strings"
)

func ParseOrigins(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var out []string
	for _, p := range strings.Split(raw, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func CORS(allowedOrigins []string, allowCredentials bool) func(http.Handler) http.Handler {
	wildcard := false
	set := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		if o == "*" {
			wildcard = true
			continue
		}
		set[o] = true
	}
	return func(next http.Handler) http.Handler {
		if len(allowedOrigins) == 0 {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			allowed := origin != "" && (wildcard || set[origin])
			if !allowed {

				w.Header().Add("Vary", "Origin")
				if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
					w.WriteHeader(http.StatusNoContent)
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			h := w.Header()
			h.Add("Vary", "Origin")

			h.Set("Access-Control-Expose-Headers", HeaderRequestID)
			if wildcard && !allowCredentials {
				h.Set("Access-Control-Allow-Origin", "*")
			} else {
				h.Set("Access-Control-Allow-Origin", origin)
			}
			if allowCredentials {
				h.Set("Access-Control-Allow-Credentials", "true")
			}
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				if m := r.Header.Get("Access-Control-Request-Method"); m != "" {
					h.Set("Access-Control-Allow-Methods", m)
				}
				if hdrs := r.Header.Get("Access-Control-Request-Headers"); hdrs != "" {
					h.Set("Access-Control-Allow-Headers", hdrs)
				}
				h.Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

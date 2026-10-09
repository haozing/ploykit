package metrics

import (
	"crypto/subtle"
	"net/http"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func (r *Registry) Handler() http.Handler {
	return promhttp.HandlerFor(r.promReg, promhttp.HandlerOpts{})
}

func (r *Registry) HandlerWithToken(token string) http.Handler {
	h := r.Handler()
	if token == "" {
		return h
	}
	want := []byte(token)
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if !tokenMatches(req, want) {
			http.NotFound(w, req)
			return
		}
		h.ServeHTTP(w, req)
	})
}

func tokenMatches(req *http.Request, want []byte) bool {
	if subtle.ConstantTimeCompare([]byte(bearerToken(req.Header.Get("Authorization"))), want) == 1 {
		return true
	}
	return subtle.ConstantTimeCompare([]byte(req.URL.Query().Get("token")), want) == 1
}

func bearerToken(auth string) string {
	const prefix = "Bearer "
	if len(auth) > len(prefix) && auth[:len(prefix)] == prefix {
		return auth[len(prefix):]
	}
	return ""
}

package webx

import (
	"net/http"
	"strings"
)

func BodyLimit(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, n)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// BodyLimitExcept is the prefix-exemption variant (storage-walk #11):
// exempt prefixes BYPASS the limit reader entirely instead of getting a
// second, larger MaxBytesReader layered on top. Layering two MaxBytesReaders
// nests the constraints — the effective limit is the MINIMUM, so the common
// product wiring of pathGate(BodyLimit(6MB), "/api/upload/") over a global
// 1MB BodyLimit silently kept 1MB in charge (field-report verified).
//
// Pairing rule (#12): a prefix whose body limit you raise almost always also
// needs TimeoutExcept — reading a large (possibly slow) body consumes the
// request-timeout budget, and a 5s global timeout bisects slow uploads no
// matter how generous the body limit is.
func BodyLimitExcept(n int64, exemptPrefixes ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for _, p := range exemptPrefixes {
				if strings.HasPrefix(r.URL.Path, p) {
					next.ServeHTTP(w, r)
					return
				}
			}
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, n)
			}
			next.ServeHTTP(w, r)
		})
	}
}

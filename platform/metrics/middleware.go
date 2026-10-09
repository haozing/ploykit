package metrics

import (
	"net/http"
	"path"
	"strings"
	"time"
)

const (
	MetricHTTPRequests = "ploykit_http_requests"

	MetricHTTPDurationSeconds = "ploykit_http_request_duration_seconds"

	labelMethod = "method"
	labelRoute  = "route"

	routeFallback = "other"

	maxRoutes = 512
)

var DefaultDurationBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

func (m *Mount) Middleware(next http.Handler) http.Handler {
	if m.reg == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		route := m.routeLabel(req)
		start := time.Now()
		defer func() {
			attrs := map[string]string{labelMethod: req.Method, labelRoute: route}
			m.reg.IncrAttrs(MetricHTTPRequests, attrs)
			m.reg.ObserveAttrs(MetricHTTPDurationSeconds, time.Since(start).Seconds(), attrs)
		}()
		next.ServeHTTP(w, req)
	})
}

func (m *Mount) routeLabel(req *http.Request) string {
	route := routeTemplate(req)
	m.seenMu.Lock()
	defer m.seenMu.Unlock()
	if m.seen == nil {
		m.seen = make(map[string]struct{})
	}
	if _, ok := m.seen[route]; ok || len(m.seen) < maxRoutes {
		m.seen[route] = struct{}{}
		return route
	}
	return routeFallback
}

func routeTemplate(req *http.Request) string {
	if p := req.Pattern; p != "" {
		return p
	}
	return normalizePath(req.URL.Path)
}

func normalizePath(p string) string {
	c := path.Clean("/" + p)
	if c == "/" {
		return "/"
	}
	segs := strings.Split(c[1:], "/")
	for i, s := range segs {
		if looksLikeValue(s) {
			segs[i] = "{id}"
		}
	}
	return "/" + strings.Join(segs, "/")
}

func looksLikeValue(s string) bool {
	if isDigits(s) {
		return true
	}
	if isUUID(s) {
		return true
	}
	if len(s) >= 8 && isHex(s) {
		return true
	}
	return len(s) >= 16 && isAlnum(s) && hasAlpha(s) && hasDigit(s)
}

func isDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return s != ""
}

func isHex(s string) bool {
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9', r >= 'a' && r <= 'f', r >= 'A' && r <= 'F':
		default:
			return false
		}
	}
	return s != ""
}

func isAlnum(s string) bool {
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9', r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z':
		default:
			return false
		}
	}
	return s != ""
}

func hasAlpha(s string) bool {
	for _, r := range s {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' {
			return true
		}
	}
	return false
}

func hasDigit(s string) bool {
	for _, r := range s {
		if r >= '0' && r <= '9' {
			return true
		}
	}
	return false
}

func isUUID(s string) bool {
	if len(s) == 36 {
		return isHex(s[0:8]) && s[8] == '-' && isHex(s[9:13]) && s[13] == '-' &&
			isHex(s[14:18]) && s[18] == '-' && isHex(s[19:23]) && s[23] == '-' && isHex(s[24:36])
	}
	return len(s) == 32 && isHex(s)
}

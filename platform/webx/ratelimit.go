package webx

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Limiter interface {
	Allow(ctx context.Context, key string, perMinute int) (ok bool, retryAfter time.Duration)
}

type FailOpenLimiter struct{}

func (FailOpenLimiter) Allow(context.Context, string, int) (bool, time.Duration) { return true, 0 }

func RateLimit(l Limiter, dimension string, perMinute int, keyFn func(r *http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := "rl:" + dimension + ":" + keyFn(r)
			ok, retry := l.Allow(r.Context(), key, perMinute)
			if !ok {
				w.Header().Set("Retry-After", strconv.Itoa(max(int(retry.Seconds())+1, 1)))
				WriteError(w, http.StatusTooManyRequests, "E_RATE_LIMITED", "too many requests", nil)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func ClientIP(r *http.Request, trustedProxies ...*net.IPNet) string {
	return extractIP(r, trustedProxies)
}

func ParseTrustedProxies(raw string) []*net.IPNet {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var nets []*net.IPNet
	for _, p := range strings.Split(raw, ",") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		_, cidr, err := net.ParseCIDR(p)
		if err != nil {
			slog.Warn("webx: invalid trusted proxy CIDR, skipping", "cidr", p, "error", err)
			continue
		}
		nets = append(nets, cidr)
	}
	return nets
}

func extractIP(r *http.Request, trustedProxies []*net.IPNet) string {
	remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteHost = r.RemoteAddr
	}
	if len(trustedProxies) > 0 {
		if remoteIP := net.ParseIP(remoteHost); remoteIP != nil && isTrustedProxy(remoteIP, trustedProxies) {
			if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
				parts := strings.Split(xff, ",")
				for i := len(parts) - 1; i >= 0; i-- {
					if candidate := net.ParseIP(strings.TrimSpace(parts[i])); candidate != nil &&
						!isTrustedProxy(candidate, trustedProxies) {
						return candidate.String()
					}
				}
			}
		}
	}
	if ip := net.ParseIP(remoteHost); ip != nil {
		return ip.String()
	}
	return remoteHost
}

func isTrustedProxy(ip net.IP, cidrs []*net.IPNet) bool {
	for _, cidr := range cidrs {
		if cidr.Contains(ip) {
			return true
		}
	}
	return false
}

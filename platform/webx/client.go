package webx

import (
	"context"
	"net"
	"net/http"
)

type clientMetadataKey int

const (
	ctxKeyClientPlatform clientMetadataKey = iota
	ctxKeyClientVersion
	ctxKeyClientOS
	ctxKeyClientIP
)

const (
	HeaderClientPlatform = "X-Client-Platform"
	HeaderClientVersion  = "X-Client-Version"
	HeaderClientOS       = "X-Client-OS"
)

const ClientUnknown = "unknown"

// ClientMetadata returns the middleware that extracts the client's
// self-reported platform triple (X-Client-Platform/Version/OS headers) and —
// computed server-side, never client-controlled — the request's source IP,
// injecting all of them into the request context. trustedProxies follows
// AccessLog's exact semantics: the same webx.ClientIP(r, trustedProxies...)
// resolution (RemoteAddr unless the remote is a trusted proxy, then the
// rightmost untrusted X-Forwarded-For hop), so acceptance-evidence readers
// (legal acceptances) and the access log record the same address. Products
// behind a reverse proxy MUST pass the same ParseTrustedProxies list they
// give AccessLog, or the ctx IP degrades to the proxy's address; products
// with no proxy front can call ClientMetadata() with no arguments.
func ClientMetadata(trustedProxies ...*net.IPNet) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			if v := r.Header.Get(HeaderClientPlatform); v != "" {
				ctx = context.WithValue(ctx, ctxKeyClientPlatform, v)
			}
			if v := r.Header.Get(HeaderClientVersion); v != "" {
				ctx = context.WithValue(ctx, ctxKeyClientVersion, v)
			}
			if v := r.Header.Get(HeaderClientOS); v != "" {
				ctx = context.WithValue(ctx, ctxKeyClientOS, v)
			}
			ctx = WithClientIP(ctx, ClientIP(r, trustedProxies...))
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func ClientMetadataFrom(ctx context.Context) (platform, version, os string) {
	platform, _ = ctx.Value(ctxKeyClientPlatform).(string)
	version, _ = ctx.Value(ctxKeyClientVersion).(string)
	os, _ = ctx.Value(ctxKeyClientOS).(string)
	if platform == "" {
		platform = ClientUnknown
	}
	if version == "" {
		version = ClientUnknown
	}
	if os == "" {
		os = ClientUnknown
	}
	return platform, version, os
}

// WithClientIP carries a resolved client IP in ctx. The ClientMetadata
// middleware is the only sanctioned writer (server-side resolution); the
// exported pair exists so non-HTTP seams (tests, workers replaying a
// captured request) can seed the same carrier downstream readers consume.
func WithClientIP(ctx context.Context, ip string) context.Context {
	return context.WithValue(ctx, ctxKeyClientIP, ip)
}

// ClientIPFrom reads the middleware-resolved client IP. Empty means "no
// ClientMetadata middleware on the chain" (or a request with no usable
// remote address) — unlike the metadata triple there is no "unknown"
// sentinel, an address either resolved or it did not.
func ClientIPFrom(ctx context.Context) string {
	ip, _ := ctx.Value(ctxKeyClientIP).(string)
	return ip
}
